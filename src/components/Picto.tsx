// Landmark pictograms for the Dakar-style roadbook. Single-colour line icons
// (currentColor) so they adapt to context. Ids match PICTOS in lib/blocks.ts.

export default function Picto({ id, size = 34 }: { id: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 44 44", fill: "none", "aria-hidden": true as const };
  const s = { stroke: "currentColor", strokeWidth: 2.4 } as const;
  switch (id) {
    case "molen":
      return (
        <svg {...common}>
          <path d="M22 6 L14 26 H30 Z" {...s} strokeLinejoin="round" />
          <rect x="18" y="26" width="8" height="10" {...s} />
          <path d="M22 12 L8 6 M22 12 L36 6 M22 12 L8 18 M22 12 L36 18" {...s} strokeLinecap="round" />
        </svg>
      );
    case "brug":
      return (
        <svg {...common}>
          <path d="M6 28 q8 -14 16 0 M22 28 q8 -14 16 0" {...s} />
          <line x1="6" y1="30" x2="38" y2="30" {...s} />
        </svg>
      );
    case "kerk":
      return (
        <svg {...common}>
          <rect x="15" y="18" width="14" height="18" {...s} />
          <path d="M13 18 L22 9 L31 18" {...s} strokeLinejoin="round" />
          <path d="M22 4 V12 M19 8 H25" {...s} />
        </svg>
      );
    case "rotonde":
      return (
        <svg {...common}>
          <circle cx="22" cy="22" r="10" {...s} />
          <path d="M22 12 V4 M34 22 h6" {...s} strokeLinecap="round" />
          <polyline points="18,7 22,3 26,7" {...s} strokeLinejoin="round" />
        </svg>
      );
    case "water":
      return (
        <svg {...common}>
          <path d="M6 18 q6 -6 12 0 t12 0 t12 0 M6 28 q6 -6 12 0 t12 0 t12 0" {...s} strokeLinecap="round" />
        </svg>
      );
    case "boom":
      return (
        <svg {...common}>
          <circle cx="22" cy="17" r="11" {...s} />
          <line x1="22" y1="28" x2="22" y2="38" {...s} />
        </svg>
      );
    case "boerderij":
      return (
        <svg {...common}>
          <rect x="8" y="20" width="14" height="16" {...s} />
          <path d="M8 20 L15 12 L22 20" {...s} strokeLinejoin="round" />
          <rect x="24" y="24" width="12" height="12" {...s} />
        </svg>
      );
    case "watertoren":
      return (
        <svg {...common}>
          <path d="M22 34 V16 M14 16 h16 l-3 -6 h-10 z" {...s} strokeLinejoin="round" />
          <rect x="17" y="30" width="10" height="6" {...s} />
        </svg>
      );
    default:
      return null;
  }
}
