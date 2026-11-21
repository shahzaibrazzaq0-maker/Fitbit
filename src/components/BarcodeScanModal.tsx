'use client';

import { useEffect, useRef, useState } from 'react';

const FORMATS = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E'] as const;

export function BarcodeScanModal({
  open,
  onClose,
  onCode,
  title,
  manualLabel,
  photoLabel,
  cameraFallback,
  closeLabel,
}: {
  open: boolean;
  onClose: () => void;
  onCode: (code: string) => void;
  title: string;
  manualLabel: string;
  photoLabel: string;
  cameraFallback: string;
  closeLabel: string;
}) {
  const [manual, setManual] = useState('');
  const [cameraNote, setCameraNote] = useState('');
  const lock = useRef(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    if (!open) return;
    lock.current = false;
    setCameraNote('');
    let scanner: { stop: () => Promise<void>; clear: () => void } | null = null;
    let dead = false;
    const start = async () => {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      if (dead) return;
      const formats = FORMATS.map((name) => Html5QrcodeSupportedFormats[name]);
      const next = new Html5Qrcode('fitbite-barcode-live', { formatsToSupport: formats, verbose: false });
      scanner = next;
      await next.start(
        { facingMode: 'environment' },
        { fps: 12, qrbox: { width: 260, height: 140 } },
        (text) => {
          const code = text.replace(/\D/g, '');
          if (lock.current || code.length < 6) return;
          lock.current = true;
          try {
            void next.stop().catch(() => undefined);
          } catch {
            /* The scanner already stopped. */
          }
          onCodeRef.current(code);
        },
        () => undefined,
      );
    };
    void start().catch(() => {
      if (!dead) setCameraNote(cameraFallback);
    });
    return () => {
      dead = true;
      try {
        // stop() throws at once when the camera never started, so the call needs its own guard.
        void scanner?.stop().then(() => scanner?.clear()).catch(() => undefined);
      } catch {
        /* No camera was running. */
      }
    };
  }, [open, cameraFallback]);

  if (!open) return null;

  const submitManual = () => {
    const code = manual.replace(/\D/g, '');
    if (code.length < 6 || lock.current) return;
    lock.current = true;
    onCode(code);
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file || lock.current) return;
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      const formats = FORMATS.map((name) => Html5QrcodeSupportedFormats[name]);
      const reader = new Html5Qrcode('fitbite-barcode-file', { formatsToSupport: formats, verbose: false });
      const text = await reader.scanFile(file, false);
      reader.clear();
      const code = text.replace(/\D/g, '');
      if (code.length < 6) {
        setCameraNote(cameraFallback);
        return;
      }
      lock.current = true;
      onCode(code);
    } catch {
      setCameraNote(cameraFallback);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] grid place-items-end bg-black/60 px-3 pb-6 backdrop-blur-md sm:place-items-center" onClick={onClose}>
      <div className="obsidian-hero on-gradient w-full max-w-[390px] overflow-hidden p-4" role="dialog" aria-modal="true" aria-labelledby="barcode-title" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="barcode-title" className="text-lg font-black tracking-[-0.03em]">{title}</h2>
          <button type="button" className="grid h-9 w-9 place-items-center rounded-full text-lg" style={{ background: 'rgba(255,255,255,0.1)' }} aria-label={closeLabel} onClick={onClose}>✕</button>
        </div>
        <div id="fitbite-barcode-live" className="barcode-frame overflow-hidden rounded-[24px] bg-black" />
        <div id="fitbite-barcode-file" className="hidden" />
        {cameraNote && <p className="mt-3 text-xs leading-relaxed text-[#d6d3d1]">{cameraNote}</p>}
        <div className="mt-3 flex gap-2">
          <input className="h-12 min-w-0 flex-1 rounded-full bg-white px-4 text-sm font-semibold text-[#0f1115]" inputMode="numeric" placeholder={manualLabel} value={manual} maxLength={14} onChange={(event) => setManual(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitManual(); }} />
          <button type="button" className="h-12 shrink-0 rounded-full bg-white px-4 text-sm font-extrabold text-[#0f1115]" onClick={submitManual}>OK</button>
        </div>
        <label className="mt-3 flex h-12 cursor-pointer items-center justify-center rounded-full text-sm font-extrabold" style={{ background: 'rgba(255,255,255,0.1)' }}>
          {photoLabel}
          <input className="hidden" type="file" accept="image/*" onChange={(event) => { void onPhoto(event.target.files?.[0]); event.target.value = ''; }} />
        </label>
      </div>
    </div>
  );
}
