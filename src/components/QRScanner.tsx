"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/**
 * Full-screen camera QR scanner. Uses getUserMedia + jsQR (works on iOS Safari
 * and Android). Calls onResult with the decoded string on the first hit.
 */
export default function QRScanner({
  onResult,
  onClose,
}: {
  onResult: (text: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        const tick = () => {
          if (stopped) return;
          if (v.readyState === v.HAVE_ENOUGH_DATA && ctx && v.videoWidth) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            if (code && code.data) {
              resultRef.current(code.data);
              return;
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setErr("Geen toegang tot de camera. Sta de camera toe in je browser, of gebruik testmodus.");
      }
    }
    start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/90 p-4">
      <div className="relative w-full max-w-sm">
        <video ref={videoRef} className="w-full rounded-xl" muted playsInline />
        <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-white/80" />
      </div>
      <p className="mt-3 text-center text-sm text-white">{err ?? "Richt de camera op de QR-code…"}</p>
      <button className="btn btn-ghost mt-4" onClick={onClose}>
        Annuleer
      </button>
    </div>
  );
}
