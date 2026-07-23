"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Renders a QR code (as a PNG data URL) for a given value, with a download link. */
export default function QRImage({ value, label }: { value: string; label?: string }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    QRCode.toDataURL(value, { width: 260, margin: 2 })
      .then(setUrl)
      .catch(() => setUrl(""));
  }, [value]);

  return (
    <div className="rounded-soft border border-polder-line p-2 text-center">
      {label ? <div className="mb-1 text-xs font-bold text-teal-dark">{label}</div> : null}
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`QR ${label ?? ""}`} className="mx-auto h-36 w-36" />
      ) : (
        <div className="mx-auto flex h-36 w-36 items-center justify-center text-xs text-polder-grey">QR…</div>
      )}
      {url ? (
        <a href={url} download={`qr-${(label ?? "code").replace(/\s+/g, "-")}.png`} className="mt-1 inline-block text-xs font-bold text-teal">
          ⬇️ Download / print
        </a>
      ) : null}
    </div>
  );
}
