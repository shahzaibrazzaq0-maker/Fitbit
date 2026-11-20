package com.fitbitepro.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothStatusCodes;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.provider.Settings;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Native BLE layer for the Watch Hub.
 *
 * Everything the web layer needs goes through {@link MainActivity.FitBiteNative}; results come back
 * as JSON strings passed to {@code window.fitbiteBle(json)}.
 *
 * Event types sent to the web layer:
 *   status     {state: scanning | idle | needs-permission | permission-denied | bluetooth-off |
 *               location-off | unsupported | scan-failed}
 *   device     {mac, name, rssi, bonded, hr, bleType}
 *   connection {state: connecting | connected | live | noHr | classic | disconnected, mac, name,
 *               reason?, status?, services?}
 *   hr         {bpm, rr[], contact}
 *   battery    {level}
 */
final class WatchBle {
    static final int PERMISSION_REQUEST = 4403;
    static final int ENABLE_BLUETOOTH_REQUEST = 4404;

    private static final UUID HR_SERVICE = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb");
    private static final UUID HR_MEASUREMENT = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb");
    private static final UUID CLIENT_CONFIG = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private static final UUID BATTERY_SERVICE = UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb");
    private static final UUID BATTERY_LEVEL = UUID.fromString("00002a19-0000-1000-8000-00805f9b34fb");

    private static final long SCAN_MS = 12000L;
    private static final long CONNECT_TIMEOUT_MS = 15000L;
    private static final long DISCOVER_DELAY_MS = 600L;
    private static final int GATT_ERROR_133 = 133;

    private final MainActivity activity;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, Integer> seenRssi = new HashMap<>();

    private ScanCallback scanCallback;
    private Runnable scanStop;
    private Runnable connectTimeout;
    private boolean scanning;

    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic batteryChar;
    private String gattMac;
    private String gattName;
    private boolean userDisconnect;
    private boolean sessionLive;
    private int connectAttempts;

    private String pendingKind;
    private String pendingMac;
    private String pendingName;

    WatchBle(MainActivity activity) {
        this.activity = activity;
    }

    // ---------------------------------------------------------------- environment

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) activity.getSystemService(Context.BLUETOOTH_SERVICE);
        return manager != null ? manager.getAdapter() : null;
    }

    private boolean hasLe() {
        return activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE);
    }

    private boolean granted(String permission) {
        return activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    /** Android 12+ needs Nearby devices (SCAN + CONNECT). Android 10-11 scans need Fine Location. */
    private boolean hasScanPermission() {
        if (Build.VERSION.SDK_INT >= 31) {
            return granted(Manifest.permission.BLUETOOTH_SCAN) && granted(Manifest.permission.BLUETOOTH_CONNECT);
        }
        return granted(Manifest.permission.ACCESS_FINE_LOCATION);
    }

    private boolean hasConnectPermission() {
        return Build.VERSION.SDK_INT < 31 || granted(Manifest.permission.BLUETOOTH_CONNECT);
    }

    private boolean locationOn() {
        LocationManager manager = (LocationManager) activity.getSystemService(Context.LOCATION_SERVICE);
        if (manager == null) return false;
        if (Build.VERSION.SDK_INT >= 28) return manager.isLocationEnabled();
        try {
            return manager.isProviderEnabled(LocationManager.GPS_PROVIDER) || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (Exception ignored) {
            return false;
        }
    }

    private void requestMissingPermissions(boolean forScan) {
        List<String> missing = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31) {
            if (forScan && !granted(Manifest.permission.BLUETOOTH_SCAN)) missing.add(Manifest.permission.BLUETOOTH_SCAN);
            if (!granted(Manifest.permission.BLUETOOTH_CONNECT)) missing.add(Manifest.permission.BLUETOOTH_CONNECT);
        } else if (forScan && !granted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            missing.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }
        if (missing.isEmpty()) return;
        activity.requestPermissions(missing.toArray(new String[0]), PERMISSION_REQUEST);
    }

    private void requestEnableBluetooth() {
        try {
            activity.startActivityForResult(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), ENABLE_BLUETOOTH_REQUEST);
        } catch (Exception ignored) {
            openBluetoothSettings();
        }
    }

    String statusJson() {
        JSONObject json = new JSONObject();
        BluetoothAdapter adapter = adapter();
        try {
            json.put("supported", adapter != null && hasLe());
            json.put("bluetoothOn", adapter != null && adapter.isEnabled());
            json.put("locationRequired", Build.VERSION.SDK_INT < 31);
            json.put("locationOn", locationOn());
            json.put("permission", hasScanPermission());
            json.put("sdk", Build.VERSION.SDK_INT);
        } catch (JSONException ignored) {
            /* Static keys never fail. */
        }
        return json.toString();
    }

    // ---------------------------------------------------------------- events

    private JSONObject event(String type, Object... pairs) {
        JSONObject json = new JSONObject();
        try {
            json.put("type", type);
            for (int index = 0; index + 1 < pairs.length; index += 2) {
                json.put(String.valueOf(pairs[index]), pairs[index + 1]);
            }
        } catch (JSONException ignored) {
            /* Keys are plain strings. */
        }
        return json;
    }

    private void emit(JSONObject event) {
        activity.runScript("window.fitbiteBle&&window.fitbiteBle(" + JSONObject.quote(event.toString()) + ")");
    }

    private void status(String state) {
        emit(event("status", "state", state, "locationRequired", Build.VERSION.SDK_INT < 31));
    }

    private void connection(String state, Object... extra) {
        JSONObject json = event("connection", "state", state, "mac", gattMac == null ? "" : gattMac, "name", gattName == null ? "" : gattName);
        try {
            for (int index = 0; index + 1 < extra.length; index += 2) {
                json.put(String.valueOf(extra[index]), extra[index + 1]);
            }
        } catch (JSONException ignored) {
            /* Keys are plain strings. */
        }
        emit(json);
    }

    // ---------------------------------------------------------------- scanning

    void startScan() {
        activity.runOnUiThread(this::beginScan);
    }

    private void beginScan() {
        BluetoothAdapter adapter = adapter();
        if (adapter == null || !hasLe()) {
            status("unsupported");
            return;
        }
        pendingKind = "scan";
        if (!hasScanPermission()) {
            status("needs-permission");
            requestMissingPermissions(true);
            return;
        }
        if (!adapter.isEnabled()) {
            status("bluetooth-off");
            requestEnableBluetooth();
            return;
        }
        pendingKind = null;
        if (Build.VERSION.SDK_INT < 31 && !locationOn()) {
            status("location-off");
            return;
        }
        runScan(adapter);
    }

    private void runScan(BluetoothAdapter adapter) {
        stopScanInternal(false);
        seenRssi.clear();
        status("scanning");
        emitBondedDevices(adapter);
        BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) {
            status("bluetooth-off");
            return;
        }
        scanCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                handleScanResult(result);
            }

            @Override
            public void onBatchScanResults(List<ScanResult> results) {
                for (ScanResult result : results) handleScanResult(result);
            }

            @Override
            public void onScanFailed(int errorCode) {
                scanning = false;
                emit(event("status", "state", "scan-failed", "code", errorCode));
            }
        };
        try {
            scanner.startScan(null, new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCallback);
            scanning = true;
        } catch (SecurityException denied) {
            status("permission-denied");
            return;
        } catch (IllegalStateException off) {
            status("bluetooth-off");
            return;
        }
        scanStop = () -> stopScanInternal(true);
        main.postDelayed(scanStop, SCAN_MS);
    }

    private void handleScanResult(ScanResult result) {
        BluetoothDevice device = result.getDevice();
        if (device == null) return;
        String mac = device.getAddress();
        ScanRecord record = result.getScanRecord();
        String name = record != null ? record.getDeviceName() : null;
        if (name == null || name.trim().isEmpty()) name = deviceName(device);
        boolean advertisesHr = false;
        if (record != null && record.getServiceUuids() != null) {
            for (ParcelUuid uuid : record.getServiceUuids()) {
                if (HR_SERVICE.equals(uuid.getUuid())) advertisesHr = true;
            }
        }
        if ((name == null || name.trim().isEmpty()) && !advertisesHr) return;
        int rssi = result.getRssi();
        Integer previous = seenRssi.get(mac);
        if (previous != null && Math.abs(previous - rssi) < 6) return;
        seenRssi.put(mac, rssi);
        emit(event(
            "device",
            "mac", mac,
            "name", name == null || name.trim().isEmpty() ? "Heart-rate sensor" : name.trim(),
            "rssi", rssi,
            "bonded", bondedState(device),
            "hr", advertisesHr,
            "bleType", typeName(device)
        ));
    }

    private void emitBondedDevices(BluetoothAdapter adapter) {
        Set<BluetoothDevice> bonded;
        try {
            bonded = adapter.getBondedDevices();
        } catch (SecurityException denied) {
            return;
        }
        if (bonded == null) return;
        for (BluetoothDevice device : bonded) {
            String name = deviceName(device);
            if (name == null || name.trim().isEmpty() || isNonWatchClass(device)) continue;
            emit(event(
                "device",
                "mac", device.getAddress(),
                "name", name.trim(),
                "rssi", JSONObject.NULL,
                "bonded", true,
                "hr", false,
                "bleType", typeName(device)
            ));
        }
    }

    private boolean isNonWatchClass(BluetoothDevice device) {
        try {
            BluetoothClass cls = device.getBluetoothClass();
            if (cls == null) return false;
            int major = cls.getMajorDeviceClass();
            return major == BluetoothClass.Device.Major.AUDIO_VIDEO
                || major == BluetoothClass.Device.Major.COMPUTER
                || major == BluetoothClass.Device.Major.PHONE
                || major == BluetoothClass.Device.Major.PERIPHERAL
                || major == BluetoothClass.Device.Major.IMAGING
                || major == BluetoothClass.Device.Major.NETWORKING;
        } catch (SecurityException denied) {
            return false;
        }
    }

    private String deviceName(BluetoothDevice device) {
        try {
            return device.getName();
        } catch (SecurityException denied) {
            return null;
        }
    }

    private boolean bondedState(BluetoothDevice device) {
        try {
            return device.getBondState() == BluetoothDevice.BOND_BONDED;
        } catch (SecurityException denied) {
            return false;
        }
    }

    private String typeName(BluetoothDevice device) {
        try {
            switch (device.getType()) {
                case BluetoothDevice.DEVICE_TYPE_LE: return "le";
                case BluetoothDevice.DEVICE_TYPE_CLASSIC: return "classic";
                case BluetoothDevice.DEVICE_TYPE_DUAL: return "dual";
                default: return "unknown";
            }
        } catch (SecurityException denied) {
            return "unknown";
        }
    }

    void stopScan() {
        activity.runOnUiThread(() -> stopScanInternal(true));
    }

    private void stopScanInternal(boolean announce) {
        if (scanStop != null) {
            main.removeCallbacks(scanStop);
            scanStop = null;
        }
        boolean wasScanning = scanning;
        if (scanning && scanCallback != null) {
            try {
                BluetoothAdapter adapter = adapter();
                BluetoothLeScanner scanner = adapter != null ? adapter.getBluetoothLeScanner() : null;
                if (scanner != null) scanner.stopScan(scanCallback);
            } catch (Exception ignored) {
                /* Bluetooth was switched off mid-scan; there is nothing left to stop. */
            }
        }
        scanning = false;
        scanCallback = null;
        if (announce && wasScanning) status("idle");
    }

    // ---------------------------------------------------------------- connection

    void connect(String mac, String name) {
        activity.runOnUiThread(() -> beginConnect(mac, name));
    }

    private void beginConnect(String mac, String name) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null || !hasLe()) {
            status("unsupported");
            return;
        }
        gattMac = mac;
        gattName = name == null ? "" : name;
        if (mac == null || !BluetoothAdapter.checkBluetoothAddress(mac)) {
            connection("disconnected", "reason", "bad-address");
            return;
        }
        pendingKind = "connect";
        pendingMac = mac;
        pendingName = gattName;
        if (!hasConnectPermission()) {
            status("needs-permission");
            requestMissingPermissions(false);
            return;
        }
        if (!adapter.isEnabled()) {
            status("bluetooth-off");
            requestEnableBluetooth();
            return;
        }
        pendingKind = null;
        stopScanInternal(false);
        cancelConnectTimeout();
        closeGatt();
        userDisconnect = false;
        sessionLive = false;
        connectAttempts = 0;
        BluetoothDevice device;
        try {
            device = adapter.getRemoteDevice(mac);
        } catch (IllegalArgumentException invalid) {
            connection("disconnected", "reason", "bad-address");
            return;
        }
        if (typeName(device).equals("classic")) {
            connection("classic");
            return;
        }
        openGatt(device);
    }

    private void openGatt(BluetoothDevice device) {
        connection("connecting");
        try {
            gatt = device.connectGatt(activity, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
        } catch (SecurityException denied) {
            gatt = null;
            status("permission-denied");
            return;
        }
        if (gatt == null) {
            connection("disconnected", "reason", "gatt-unavailable");
            return;
        }
        connectTimeout = () -> {
            connectTimeout = null;
            if (gatt != null && !sessionLive) {
                closeGatt();
                connection("disconnected", "reason", "timeout");
            }
        };
        main.postDelayed(connectTimeout, CONNECT_TIMEOUT_MS);
    }

    private void cancelConnectTimeout() {
        if (connectTimeout != null) {
            main.removeCallbacks(connectTimeout);
            connectTimeout = null;
        }
    }

    /** Releases the GATT client. Closing is what keeps status 133 from poisoning the next attempt. */
    private void closeGatt() {
        BluetoothGatt current = gatt;
        gatt = null;
        batteryChar = null;
        if (current == null) return;
        try {
            current.disconnect();
        } catch (Exception ignored) {
            /* Already disconnected. */
        }
        try {
            current.close();
        } catch (Exception ignored) {
            /* Already closed. */
        }
    }

    void disconnect() {
        activity.runOnUiThread(() -> {
            userDisconnect = true;
            pendingKind = null;
            cancelConnectTimeout();
            boolean hadLink = gatt != null || sessionLive;
            closeGatt();
            sessionLive = false;
            if (hadLink || gattMac != null) connection("disconnected", "reason", "user");
        });
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt source, int status, int newState) {
            main.post(() -> handleConnectionState(source, status, newState));
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt source, int status) {
            main.post(() -> handleServices(source, status));
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt source, BluetoothGattDescriptor descriptor, int status) {
            main.post(() -> handleDescriptorWrite(source, descriptor, status));
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt source, BluetoothGattCharacteristic characteristic) {
            @SuppressWarnings("deprecation")
            byte[] value = characteristic.getValue();
            if (value != null) deliverCharacteristic(source, characteristic.getUuid(), value.clone());
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt source, BluetoothGattCharacteristic characteristic, byte[] value) {
            if (value != null) deliverCharacteristic(source, characteristic.getUuid(), value.clone());
        }

        @Override
        public void onCharacteristicRead(BluetoothGatt source, BluetoothGattCharacteristic characteristic, int status) {
            @SuppressWarnings("deprecation")
            byte[] value = characteristic.getValue();
            if (value != null) deliverRead(source, characteristic.getUuid(), value.clone(), status);
        }

        @Override
        public void onCharacteristicRead(BluetoothGatt source, BluetoothGattCharacteristic characteristic, byte[] value, int status) {
            if (value != null) deliverRead(source, characteristic.getUuid(), value.clone(), status);
        }
    };

    private void deliverCharacteristic(BluetoothGatt source, UUID uuid, byte[] value) {
        if (!HR_MEASUREMENT.equals(uuid)) return;
        main.post(() -> {
            if (source == gatt) parseHeartRate(value);
        });
    }

    private void deliverRead(BluetoothGatt source, UUID uuid, byte[] value, int status) {
        if (status != BluetoothGatt.GATT_SUCCESS || !BATTERY_LEVEL.equals(uuid) || value.length < 1) return;
        int level = value[0] & 0xFF;
        main.post(() -> {
            if (source == gatt && level >= 0 && level <= 100) emit(event("battery", "level", level));
        });
    }

    private void handleConnectionState(BluetoothGatt source, int status, int newState) {
        if (source != gatt) {
            try {
                source.close();
            } catch (Exception ignored) {
                /* A stale client from a previous attempt. */
            }
            return;
        }
        cancelConnectTimeout();
        if (newState == android.bluetooth.BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
            connection("connected");
            main.postDelayed(() -> {
                if (source != gatt) return;
                boolean started = false;
                try {
                    started = source.discoverServices();
                } catch (SecurityException denied) {
                    /* Handled below. */
                }
                if (!started) {
                    closeGatt();
                    connection("disconnected", "reason", "discovery-failed");
                }
            }, DISCOVER_DELAY_MS);
            return;
        }
        boolean retry = status == GATT_ERROR_133 && !userDisconnect && !sessionLive && connectAttempts < 1 && gattMac != null;
        closeGatt();
        sessionLive = false;
        if (retry) {
            connectAttempts += 1;
            final String retryMac = gattMac;
            main.postDelayed(() -> {
                if (userDisconnect || gatt != null) return;
                BluetoothAdapter adapter = adapter();
                if (adapter == null || !adapter.isEnabled()) {
                    connection("disconnected", "reason", "bluetooth-off");
                    return;
                }
                try {
                    openGatt(adapter.getRemoteDevice(retryMac));
                } catch (IllegalArgumentException invalid) {
                    connection("disconnected", "reason", "bad-address");
                }
            }, 600L);
            return;
        }
        String reason = userDisconnect ? "user"
            : status == GATT_ERROR_133 ? "gatt-133"
            : status == 8 ? "link-lost"
            : status == 19 || status == 0 ? "remote-closed"
            : "error";
        connection("disconnected", "reason", reason, "status", status);
    }

    private void handleServices(BluetoothGatt source, int status) {
        if (source != gatt) return;
        if (status != BluetoothGatt.GATT_SUCCESS) {
            connection("noHr", "reason", "service-discovery-failed", "status", status);
            return;
        }
        sessionLive = true;
        JSONArray services = new JSONArray();
        for (BluetoothGattService service : source.getServices()) services.put(shortUuid(service.getUuid()));
        BluetoothGattService battery = source.getService(BATTERY_SERVICE);
        batteryChar = battery != null ? battery.getCharacteristic(BATTERY_LEVEL) : null;
        BluetoothGattService heart = source.getService(HR_SERVICE);
        BluetoothGattCharacteristic measurement = heart != null ? heart.getCharacteristic(HR_MEASUREMENT) : null;
        if (measurement == null) {
            connection("noHr", "reason", "no-0x180d", "services", services);
            readBattery(source);
            return;
        }
        boolean notifying = false;
        BluetoothGattDescriptor config = measurement.getDescriptor(CLIENT_CONFIG);
        try {
            notifying = source.setCharacteristicNotification(measurement, true);
        } catch (SecurityException denied) {
            /* Falls through to the noHr state. */
        }
        if (notifying && config != null) {
            byte[] enable = (measurement.getProperties() & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0
                ? BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                : BluetoothGattDescriptor.ENABLE_INDICATION_VALUE;
            if (writeDescriptor(source, config, enable)) return;
        }
        connection("noHr", "reason", "subscribe-failed", "services", services);
        readBattery(source);
    }

    @SuppressWarnings("deprecation")
    private boolean writeDescriptor(BluetoothGatt source, BluetoothGattDescriptor descriptor, byte[] value) {
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                return source.writeDescriptor(descriptor, value) == BluetoothStatusCodes.SUCCESS;
            }
            descriptor.setValue(value);
            return source.writeDescriptor(descriptor);
        } catch (SecurityException denied) {
            return false;
        }
    }

    private void handleDescriptorWrite(BluetoothGatt source, BluetoothGattDescriptor descriptor, int status) {
        if (source != gatt) return;
        BluetoothGattCharacteristic owner = descriptor.getCharacteristic();
        if (owner == null || !HR_MEASUREMENT.equals(owner.getUuid())) return;
        if (status == BluetoothGatt.GATT_SUCCESS) connection("live");
        else connection("noHr", "reason", "subscribe-failed", "status", status);
        readBattery(source);
    }

    private void readBattery(BluetoothGatt source) {
        if (batteryChar == null || source != gatt) return;
        try {
            source.readCharacteristic(batteryChar);
        } catch (SecurityException denied) {
            /* Battery is optional. */
        }
    }

    /** Heart Rate Measurement: bit 0 selects UINT8 or UINT16 (little-endian) BPM. */
    private void parseHeartRate(byte[] value) {
        if (value.length < 2) return;
        int flags = value[0] & 0xFF;
        boolean wide = (flags & 0x01) != 0;
        int bpm;
        int offset;
        if (wide) {
            if (value.length < 3) return;
            bpm = (value[1] & 0xFF) | ((value[2] & 0xFF) << 8);
            offset = 3;
        } else {
            bpm = value[1] & 0xFF;
            offset = 2;
        }
        boolean contactSupported = (flags & 0x04) != 0;
        boolean contact = (flags & 0x02) != 0;
        if ((flags & 0x08) != 0) offset += 2;
        JSONArray rr = new JSONArray();
        if ((flags & 0x10) != 0) {
            while (offset + 1 < value.length) {
                int raw = (value[offset] & 0xFF) | ((value[offset + 1] & 0xFF) << 8);
                rr.put(Math.round(raw * 1000f / 1024f));
                offset += 2;
            }
        }
        if (contactSupported && !contact) {
            emit(event("hr", "bpm", 0, "contact", false, "rr", new JSONArray()));
            return;
        }
        if (bpm < 30 || bpm > 230) return;
        emit(event("hr", "bpm", bpm, "contact", true, "rr", rr));
    }

    private String shortUuid(UUID uuid) {
        String text = uuid.toString();
        return text.startsWith("0000") && text.endsWith("-0000-1000-8000-00805f9b34fb") ? "0x" + text.substring(4, 8) : text;
    }

    // ---------------------------------------------------------------- activity hooks

    void onPermissionsResult() {
        String kind = pendingKind;
        if (kind == null) return;
        boolean ok = "scan".equals(kind) ? hasScanPermission() : hasConnectPermission();
        if (!ok) {
            pendingKind = null;
            status("permission-denied");
            return;
        }
        resumePending();
    }

    void onEnableResult(boolean enabled) {
        if (pendingKind == null) return;
        BluetoothAdapter adapter = adapter();
        if (enabled && adapter != null && adapter.isEnabled()) {
            resumePending();
            return;
        }
        pendingKind = null;
        status("bluetooth-off");
    }

    private void resumePending() {
        String kind = pendingKind;
        if ("scan".equals(kind)) beginScan();
        else if ("connect".equals(kind)) beginConnect(pendingMac, pendingName);
    }

    void openBluetoothSettings() {
        try {
            activity.startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS));
        } catch (Exception ignored) {
            /* No settings screen to open. */
        }
    }

    void openLocationSettings() {
        try {
            activity.startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));
        } catch (Exception ignored) {
            /* No settings screen to open. */
        }
    }

    void openAppSettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", activity.getPackageName(), null));
            activity.startActivity(intent);
        } catch (Exception ignored) {
            /* No settings screen to open. */
        }
    }

    void destroy() {
        stopScanInternal(false);
        cancelConnectTimeout();
        userDisconnect = true;
        closeGatt();
    }
}
