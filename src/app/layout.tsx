import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Polderpuzzel rallye",
  description:
    "Doe-het-zelf puzzelrally's per auto, fiets of te voet — één telefoon per team.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#085041",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body className="font-sans">
        {children}
        <footer className="fixed inset-x-0 bottom-0 z-[100] flex items-center justify-center gap-2.5 bg-teal-dark px-5 py-3 text-[13px] font-semibold tracking-wide text-[#CFEDE1]">
          <span>Polderpuzzel rallye</span>
          <span>·</span>
          <span>Next.js + Supabase</span>
          <span>·</span>
          <span className="rounded-xl bg-coral px-2.5 py-0.5 text-xs text-white">
            v0.6
          </span>
        </footer>
      </body>
    </html>
  );
}
