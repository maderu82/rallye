// ============================================================================
// The 12 building blocks (spec §3.2) and navigation modes (§3.5A).
// Single source of truth for labels, grading, and editor dropdowns.
// ============================================================================

export type Grading = "auto" | "scale" | "manual";
export type BlockType =
  | "multiple_choice"
  | "open_question"
  | "observation"
  | "code_breaker"
  | "estimation"
  | "ordering"
  | "photo_search"
  | "qr_checkpoint"
  | "qr_search"
  | "speed_test"
  | "compass_point"
  | "video_task"
  | "free_game";

export interface BlockDef {
  type: BlockType;
  /** Dutch label shown in the editor dropdown. */
  label: string;
  grading: Grading;
  icon: string;
  /** Short Dutch description of what the team does. */
  blurb: string;
}

// Order matches the spec's numbered list 1..12.
export const BLOCKS: BlockDef[] = [
  { type: "multiple_choice", label: "Meerkeuzevraag", grading: "auto", icon: "❓", blurb: "Kies het juiste antwoord uit meerdere opties." },
  { type: "open_question", label: "Open vraag (tekst/getal)", grading: "auto", icon: "✍️", blurb: "Typ het antwoord in; de app controleert het." },
  { type: "observation", label: "Observatievraag onderweg", grading: "auto", icon: "👀", blurb: "Beantwoord een vraag over iets dat je onderweg ziet." },
  { type: "code_breaker", label: "Codekraker / cijferpuzzel / rebus", grading: "auto", icon: "🔐", blurb: "Kraak een code; hint eerst, daarna cijfers koopbaar." },
  { type: "estimation", label: "Schatting met marge", grading: "scale", icon: "📏", blurb: "Schat een waarde; punten naar nauwkeurigheid." },
  { type: "ordering", label: "Volgorde / sorteren", grading: "auto", icon: "🔢", blurb: "Zet items in de juiste volgorde." },
  { type: "photo_search", label: "Fotozoekopdracht", grading: "auto", icon: "📸", blurb: "Vind iets en fotografeer het als bewijs." },
  { type: "qr_checkpoint", label: "QR-checkpoint", grading: "auto", icon: "✅", blurb: "Scan de QR als bewijs van aanwezigheid." },
  { type: "qr_search", label: "QR-zoekopdracht", grading: "auto", icon: "🔍", blurb: "Meerdere bordjes; alleen het juiste scoort." },
  { type: "speed_test", label: "Gemiddelde-snelheidsproef", grading: "scale", icon: "⏱️", blurb: "Rijd een doelgemiddelde; gps meet het resultaat." },
  { type: "compass_point", label: "Kompasnavigatiepunt", grading: "auto", icon: "🧭", blurb: "Navigeer op koers + afstand naar het punt." },
  { type: "video_task", label: "Video-opdracht", grading: "manual", icon: "🎥", blurb: "Neem een filmpje op of upload er een als inzending." },
  { type: "free_game", label: "Vrij spelmoment", grading: "manual", icon: "🎪", blurb: "Fysiek spel bij een stop; score handmatig ingevoerd." },
];

export const BLOCK_BY_TYPE: Record<BlockType, BlockDef> = Object.fromEntries(
  BLOCKS.map((b) => [b.type, b]),
) as Record<BlockType, BlockDef>;

export const GRADING_LABEL: Record<Grading, string> = {
  auto: "AUTO",
  scale: "SCALE",
  manual: "HANDMATIG",
};

// ── Navigation modes per leg (§3.5A) ────────────────────────────────────────
export type NavMode = "compass" | "routebook" | "turn" | "map";

export interface NavDef {
  mode: NavMode;
  label: string;
  icon: string;
}

export const NAV_MODES: NavDef[] = [
  { mode: "compass", label: "Kompas (koers + afstand)", icon: "🧭" },
  { mode: "routebook", label: "Straatboek / routebeschrijving", icon: "📖" },
  { mode: "turn", label: "Bolletje-pijltje ('na 200 m rechts')", icon: "↪️" },
  { mode: "map", label: "Kaart met waypoints", icon: "🗺️" },
];

export const NAV_BY_MODE: Record<NavMode, NavDef> = Object.fromEntries(
  NAV_MODES.map((n) => [n.mode, n]),
) as Record<NavMode, NavDef>;

// ── roadbook (bolletje-pijltje) directions ──────────────────────────────────
export interface RoadbookDir {
  id: string;
  label: string;
  icon: string;
}
export const ROADBOOK_DIRS: RoadbookDir[] = [
  { id: "straight", label: "Rechtdoor", icon: "⬆️" },
  { id: "slight_left", label: "Flauw links", icon: "↖️" },
  { id: "slight_right", label: "Flauw rechts", icon: "↗️" },
  { id: "left", label: "Links", icon: "⬅️" },
  { id: "right", label: "Rechts", icon: "➡️" },
  { id: "sharp_left", label: "Scherp links", icon: "↙️" },
  { id: "sharp_right", label: "Scherp rechts", icon: "↘️" },
  { id: "uturn", label: "Keren", icon: "↩️" },
  { id: "roundabout", label: "Rotonde", icon: "🔄" },
  { id: "arrive", label: "Bestemming", icon: "🏁" },
];
export const ROADBOOK_BY_ID: Record<string, RoadbookDir> = Object.fromEntries(
  ROADBOOK_DIRS.map((d) => [d.id, d]),
);

export type HintMode = "off" | "free" | "cost";
export const HINT_LABEL: Record<HintMode, string> = {
  off: "Uit",
  free: "Gratis",
  cost: "Tegen puntenkosten",
};
