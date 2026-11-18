package com.fitbitepro.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final int AUDIO_CAPTURE_REQUEST = 4401;
    private static final int PICK_AUDIO_REQUEST = 4402;
    private PermissionRequest pendingAudioRequest;

    public static class FitBiteNative {
        private final MainActivity activity;

        FitBiteNative(MainActivity activity) {
            this.activity = activity;
        }

        @JavascriptInterface
        public void openPhoneMusicApp() {
            activity.runOnUiThread(activity::launchPhoneMusic);
        }

        @JavascriptInterface
        public void pickAudioTrack() {
            activity.runOnUiThread(activity::launchAudioPicker);
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (bridge == null || bridge.getWebView() == null) return;
        bridge.getWebView().addJavascriptInterface(new FitBiteNative(this), "FitBiteNative");
        bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(bridge) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                boolean audio = false;
                for (String resource : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) audio = true;
                }
                if (!audio) {
                    super.onPermissionRequest(request);
                    return;
                }
                if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    pendingAudioRequest = request;
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO, Manifest.permission.MODIFY_AUDIO_SETTINGS}, AUDIO_CAPTURE_REQUEST);
                    return;
                }
                request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            }
        });
    }

    private void launchPhoneMusic() {
        try {
            Intent intent = Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_MUSIC);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception ignored) {
            try {
                Intent fallback = new Intent(MediaStore.INTENT_ACTION_MUSIC_PLAYER);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(fallback);
            } catch (Exception nested) {
                /* The phone has no music app to open. */
            }
        }
    }

    private void launchAudioPicker() {
        Intent intent = new Intent(Intent.ACTION_PICK, MediaStore.Audio.Media.EXTERNAL_CONTENT_URI);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivityForResult(intent, PICK_AUDIO_REQUEST);
        } catch (Exception ignored) {
            /* The music library is unavailable. */
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != AUDIO_CAPTURE_REQUEST || pendingAudioRequest == null) return;
        PermissionRequest pending = pendingAudioRequest;
        pendingAudioRequest = null;
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) pending.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        else pending.deny();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_AUDIO_REQUEST || resultCode != RESULT_OK || data == null || data.getData() == null) return;
        deliverPickedAudio(data.getData());
    }

    private void deliverPickedAudio(Uri uri) {
        String title = "Selected track";
        try (Cursor cursor = getContentResolver().query(uri, new String[]{MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int titleIndex = cursor.getColumnIndex(MediaStore.Audio.Media.TITLE);
                int nameIndex = cursor.getColumnIndex(MediaStore.Audio.Media.DISPLAY_NAME);
                String value = titleIndex >= 0 ? cursor.getString(titleIndex) : null;
                if (value == null && nameIndex >= 0) value = cursor.getString(nameIndex);
                if (value != null && !value.trim().isEmpty()) title = value.trim();
            }
        } catch (Exception ignored) {
            /* The library title is optional. */
        }
        File dir = new File(getCacheDir(), "phone-music");
        if (!dir.exists() && !dir.mkdirs()) return;
        File out = new File(dir, "picked-track");
        try (InputStream input = getContentResolver().openInputStream(uri); OutputStream output = new FileOutputStream(out)) {
            if (input == null) return;
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
        } catch (Exception ignored) {
            return;
        }
        if (bridge == null || bridge.getWebView() == null) return;
        String script = "window.fitbiteOnAudioPicked&&window.fitbiteOnAudioPicked(" + JSONObject.quote(title) + "," + JSONObject.quote(out.getAbsolutePath()) + ")";
        bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(script, null));
    }
}
