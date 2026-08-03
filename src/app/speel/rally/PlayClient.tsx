"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import type { PlayState } from "@/lib/play/data";
import type { LeaderboardRow, Leg, Point, PublicAssignment } from "@/lib/types";
import { BLOCK_BY_TYPE, DANGER_LABEL, GRADING_LABEL, NAV_BY_MODE, ROADBOOK_BY_ID } from "@/lib/blocks";
import { answerEnroute, buyDigit, buyNextStep, createMediaUploadUrl, endTestPlay, finishRally, leaveTeam, reportPosition, scoreRoute, submitAnswer, submitAnswerWithPhoto, submitMedia, useHint } from "@/lib/play/actions";
import { NEXT_STEP_COST } from "@/lib/play/constants";
import TulipGlyph from "@/components/TulipGlyph";
import RoadArrowGlyph from "@/components/RoadArrowGlyph";
import Picto from "@/components/Picto";
import { createClient } from "@/lib/supabase/client";
import QRScanner from "@/components/QRScanner";

const RouteLineMap = dynamic(() => import("@/components/RouteLineMap"), {
  ssr: false,
  loading: () => <div className="h-[320px] w-full animate-pulse rounded-card bg-paper" />,
});

// Pick a readable text color (dark or white) for a given brand background.
function readableInk(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // relative luminance (sRGB) → dark ink on light colors, white on dark
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#123B2E" : "#ffffff";
}

// Max length for a video-opdracht: keeps uploads small (fits a default bucket).
const MAX_VIDEO_SEC = 10;

// ── arrival sound + haptics ──────────────────────────────────────────────────
let audioCtx: AudioContext | null = null;
function ensureAudio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}
function tone(ctx: AudioContext, freq: number, at: number, dur: number, vol = 0.2) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(vol, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + dur + 0.03);
}
// "assignment" = reached a rally point: a grand rising 3-note chime (bigger).
// "waypoint" = intermediate point: the two-tone "ding-dong".
function arrivalFeedback(kind: "assignment" | "waypoint") {
  const ctx = ensureAudio();
  if (ctx) {
    const t = ctx.currentTime;
    if (kind === "assignment") {
      // ascending major triad ending on a held, fuller note — feels "big".
      tone(ctx, 660, t, 0.18, 0.24);
      tone(ctx, 880, t + 0.17, 0.18, 0.26);
      tone(ctx, 1320, t + 0.34, 0.55, 0.3);
    } else {
      // two-tone ding-dong for an intermediate waypoint
      tone(ctx, 880, t, 0.16);
      tone(ctx, 1245, t + 0.18, 0.3);
    }
  }
  try {
    navigator.vibrate?.(kind === "assignment" ? [200, 90, 200, 90, 300] : [140, 70, 140]);
  } catch {
    /* not supported */
  }
}

// Short explanation per navigation mode, shown in the intro for the modes this
// rally actually uses.
const NAV_INTRO: Record<string, { icon: string; title: string; text: string }> = {
  compass: { icon: "🧭", title: "Kompas", text: "Volg de pijl naar het punt. Draai tot de gekleurde pijl omhoog wijst (of rijd vooruit) en de afstand daalt." },
  turn: { icon: "↪️", title: "Bolletje-pijltje", text: "Volg de schema's stap voor stap: het bolletje is jij, de lijn toont de afslag. Vink af wat je gehad hebt." },
  routebook: { icon: "📖", title: "Routeboek", text: "Volg de geschreven aanwijzingen op volgorde tot je op de bestemming bent." },
  cryptic: { icon: "🕵️", title: "Cryptische route", text: "Los het raadsel op en ga erheen. Pas als je op die plek bent, verschijnt de volgende aanwijzing." },
  photo_nav: { icon: "📷", title: "Foto-navigatie", text: "Zoek de plek van de foto. Ben je er, tik 'We zijn er!' — dan komt de volgende foto." },
  line: { icon: "📐", title: "De harde lijn", text: "Ouderwets kaartlezen: volg de getekende lijn van start naar finish. De gps begeleidt niet, maar meet wél mee — achteraf zie je hoeveel van de route je volgde en hoeveel punten dat oplevert." },
  dakar: { icon: "🧭", title: "Roadbook", text: "Rijd op je ritmeter (gereden km). Elke regel: 'over zoveel km, dikke pijl, herkenningspunt'. Raak je uit sync? Zet de ritmeter op een herkenbaar punt op 0 met de reset-knop. Je krijgt een piep zodra je een punt bereikt." },
  map: { icon: "🗺️", title: "Kaart", text: "Volg de route op de kaart naar het volgende punt." },
};

// Intro/onboarding shown once after joining: how navigation works in THIS rally
// + the arrival signals, ending with a confirmation.
function IntroScreen({
  rally,
  navModes,
  onDone,
}: {
  rally: { name: string; brand_logo: string | null };
  navModes: string[];
  onDone: () => void;
}) {
  const modes = navModes.map((m) => NAV_INTRO[m]).filter(Boolean);
  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-teal-dark/60 p-4">
      <div className="mx-auto my-6 max-w-[480px] rounded-card bg-white p-5 shadow-card">
        <div className="mb-3 flex items-center gap-3">
          {rally.brand_logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={rally.brand_logo} alt="" className="h-10 rounded bg-white object-contain" />
          ) : (
            <span className="text-3xl">🧭</span>
          )}
          <div>
            <h2 className="text-lg font-bold text-teal-dark">Welkom bij {rally.name}</h2>
            <p className="text-xs text-polder-grey">Lees dit even door voordat je begint.</p>
          </div>
        </div>

        <div className="rounded-soft bg-coral-light p-2.5 text-[12px] text-coral">
          📡 <b>Zet nauwkeurige locatie én geluid aan.</b> Zonder nauwkeurige locatie klopt de navigatie niet.
        </div>

        {modes.length ? (
          <>
            <h3 className="mt-3 text-sm font-bold uppercase tracking-wide text-teal-dark">Zo navigeer je in deze rally</h3>
            <div className="mt-1.5 space-y-2">
              {modes.map((m, i) => (
                <div key={i} className="flex items-start gap-2.5 rounded-soft border-2 border-polder-line p-2.5">
                  <span className="text-2xl leading-none">{m.icon}</span>
                  <div>
                    <div className="text-sm font-bold text-ink">{m.title}</div>
                    <div className="text-[12px] text-polder-grey">{m.text}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}

        <h3 className="mt-3 text-sm font-bold uppercase tracking-wide text-teal-dark">De signalen (tik om te horen)</h3>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <button className="btn btn-ghost py-2.5 text-xs leading-tight" onClick={() => arrivalFeedback("waypoint")}>
            🔉 Tussenpunt<br />
            <span className="text-[10px] text-polder-grey">ding-dong</span>
          </button>
          <button className="btn btn-ghost py-2.5 text-xs leading-tight" onClick={() => arrivalFeedback("assignment")}>
            🔔 Opdrachtpunt<br />
            <span className="text-[10px] text-polder-grey">groot melodietje + trilling</span>
          </button>
        </div>

        <button className="btn btn-primary mt-4 w-full" onClick={onDone}>
          ✅ Ik heb het begrepen — beginnen!
        </button>
      </div>
    </div>
  );
}

// Read a video file's duration (seconds) from its metadata; 0 if unreadable.
function videoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(v.duration) ? v.duration : 0);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    v.src = url;
  });
}

// Downscale a captured photo client-side to keep uploads small (<~8 MB action
// limit) and fast on mobile connections.
async function downscale(file: File, maxDim = 1600, quality = 0.8): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
    return blob ?? file;
  } catch {
    return file;
  }
}

// ============================================================================
// Participant play flow. All scoring goes through server actions; this client
// only reflects results. Answer keys are never present here.
// ============================================================================

type Toast = { id: number; msg: string };

export default function PlayClient({
  state,
  leaderboard,
  testMode = false,
  startStep,
}: {
  state: PlayState;
  leaderboard: LeaderboardRow[];
  testMode?: boolean;
  startStep?: number;
}) {
  const waypoints = useMemo(
    () => state.points.filter((p) => p.kind === "waypoint").sort((a, b) => a.position - b.position),
    [state.points],
  );
  const finishPoint = state.points.find((p) => p.kind === "finish");
  // The finish is a real navigable step too: the team must still drive the last
  // leg to it (and arrive) before the rally is done — it isn't skipped.
  const flowPoints = useMemo(
    () => (finishPoint ? [...waypoints, finishPoint] : waypoints),
    [waypoints, finishPoint],
  );
  const assignmentByPoint = useMemo(() => {
    const m = new Map<string, PublicAssignment>();
    for (const a of state.assignments) m.set(a.point_id, a);
    return m;
  }, [state.assignments]);
  const legByPosition = useMemo(() => {
    const m = new Map<number, Leg>();
    for (const l of state.legs) m.set(l.position, l);
    return m;
  }, [state.legs]);

  // completed assignment ids from history
  const initialCompleted = useMemo(() => {
    const s = new Set<string>();
    for (const e of state.events) {
      if (e.assignment_id && (e.detail as { complete?: boolean })?.complete) s.add(e.assignment_id);
    }
    return s;
  }, [state.events]);

  const [completed, setCompleted] = useState<Set<string>>(initialCompleted);
  const [score, setScore] = useState(state.score);
  const [step, setStep] = useState(() => {
    // test mode: the organizer can jump straight to a chosen step
    if (testMode && startStep != null) return Math.max(0, Math.min(startStep, flowPoints.length));
    // resume at the first not-yet-completed step (finish has no task, so the
    // team lands there to navigate the last leg once all waypoints are done)
    const idx = flowPoints.findIndex((w) => {
      const a = assignmentByPoint.get(w.id);
      return !a || !initialCompleted.has(a.id);
    });
    return idx === -1 ? flowPoints.length : idx;
  });
  const [badges, setBadges] = useState(state.badges.map((b) => ({ name: b.name, icon: b.icon })));
  const [lbOpen, setLbOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [remoteBoard, setRemoteBoard] = useState<LeaderboardRow[]>(leaderboard);
  const [answeredEnroute, setAnsweredEnroute] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const e of state.events) {
      const d = e.detail as { leg_id?: string; complete?: boolean };
      if (e.kind === "enroute" && d?.leg_id && d.complete) s.add(d.leg_id);
    }
    return s;
  });

  const rallyId = state.rally.id;
  const teamId = state.team.id;
  const [geoDenied, setGeoDenied] = useState(false);
  const [gpsAcc, setGpsAcc] = useState<number | null>(null);
  const [gpsWarnHidden, setGpsWarnHidden] = useState(false);
  const navModesUsed = useMemo(() => Array.from(new Set(state.legs.map((l) => l.nav_mode))), [state.legs]);
  const [showIntro, setShowIntro] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(`intro:${state.rally.id}`) !== "1") setShowIntro(true);
    } catch {
      setShowIntro(true);
    }
  }, [state.rally.id]);

  // Ask for location up front so the browser prompt appears at the start of the
  // rally (GPS is needed for unlocking assignments and for the compass).
  function requestLocation() {
    if (!("geolocation" in navigator)) {
      setGeoDenied(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      () => setGeoDenied(false),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setGeoDenied(true);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }
  useEffect(() => {
    requestLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Report the team's live position to the server (throttled) so the organizer's
  // live view shows where the team actually is.
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    let last = 0;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setGpsAcc(Math.round(p.coords.accuracy || 0));
        const now = Date.now();
        if (now - last < 15000) return; // at most every 15s
        last = now;
        void reportPosition(p.coords.latitude, p.coords.longitude, p.coords.speed, p.coords.accuracy);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Live leaderboard via Supabase Realtime: subscribe to team_scores changes for
  // this rally and refetch on any update (other teams scoring, finishing, …).
  useEffect(() => {
    const supabase = createClient();
    async function refetch() {
      const { data } = await supabase
        .from("team_scores")
        .select("team_id,name,score,hints,current_index,finished")
        .eq("rally_id", rallyId);
      if (data) {
        setRemoteBoard(
          data.map((r) => ({
            team_id: r.team_id,
            name: r.name,
            score: r.score,
            hints: r.hints,
            current_index: r.current_index,
            finished: r.finished,
            me: r.team_id === teamId,
          })),
        );
      }
    }
    const channel = supabase
      .channel(`scores:${rallyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_scores", filter: `rally_id=eq.${rallyId}` }, refetch)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [rallyId, teamId]);

  function toast(msg: string) {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2200);
  }

  function onScored(newScore: number, badge?: { name: string; icon: string }) {
    setScore(newScore);
    if (badge && !badges.some((b) => b.name === badge.name)) {
      setBadges((b) => [...b, badge]);
      setTimeout(() => toast(`${badge.icon} Badge verdiend: ${badge.name}!`), 700);
    }
  }

  const atFinish = step >= flowPoints.length;

  // Live leaderboard: realtime rows for other teams + the player's own running
  // score (kept optimistic locally so it reflects instantly after each action).
  const liveBoard = useMemo(() => {
    const rows = remoteBoard.map((r) => (r.team_id === teamId ? { ...r, me: true, score } : r));
    if (!rows.some((r) => r.team_id === teamId)) {
      rows.push({ team_id: teamId, name: state.team.name, score, hints: state.hintsUsed, current_index: 0, finished: false, me: true });
    }
    return rows.sort((a, b) => b.score - a.score);
  }, [remoteBoard, score, teamId, state.team.name, state.hintsUsed]);

  const title = atFinish
    ? "Finish"
    : flowPoints[step]?.kind === "finish"
      ? "Naar de finish"
      : `Waypoint ${step + 1} van ${waypoints.length}`;

  // Branding: theme the primary button + progress with the rally color, and
  // pick a readable ink color (dark on a light brand, white on a dark one).
  const brand = state.rally.brand_color;
  const brandStyle = brand
    ? ({ "--brand": brand, "--brand-ink": readableInk(brand) } as CSSProperties)
    : undefined;

  return (
    <main className={`mx-auto flex min-h-[100dvh] w-full max-w-[520px] flex-col ${brand ? "branded" : ""}`} style={brandStyle}>
      {testMode ? (
        <div className="flex items-center justify-center gap-3 bg-[#FFF4D6] px-4 py-1.5 text-center text-xs font-bold text-[#7A5D00]">
          <span>🧪 Testmodus — hulpknoppen zijn zichtbaar; deelnemers zien deze niet.</span>
          <form action={endTestPlay}>
            <button type="submit" className="rounded-full bg-[#7A5D00] px-2.5 py-0.5 text-white">✖ Einde test</button>
          </form>
        </div>
      ) : null}

      {gpsAcc != null && gpsAcc > 150 && !gpsWarnHidden ? (
        <div className="flex items-start gap-2 bg-coral-light px-4 py-2 text-[12px] text-coral">
          <div className="flex-1">
            📡 <b>Onnauwkeurige locatie (±{gpsAcc >= 1000 ? `${(gpsAcc / 1000).toFixed(1)} km` : `${gpsAcc} m`}).</b> Zet <b>nauwkeurige locatie</b> aan, anders kloppen kaart, kompas en aankomst niet.
            <span className="mt-0.5 block text-[11px] text-polder-grey">
              iPhone: Instellingen → Privacy → Locatievoorzieningen → Safari → <b>Nauwkeurige locatie</b> aan. Android: Chrome → siterechten → Locatie → <b>Nauwkeurig</b>.
            </span>
          </div>
          <button className="shrink-0 font-bold" onClick={() => setGpsWarnHidden(true)}>✕</button>
        </div>
      ) : null}
      <header
        className="sticky top-0 z-30 flex items-center gap-2.5 bg-teal px-4 py-3 text-white shadow-soft"
        style={state.rally.brand_color ? { background: state.rally.brand_color } : undefined}
      >
        <a href="/" className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white/20 text-base" title="Startscherm">
          ⌂
        </a>
        {state.rally.brand_logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={state.rally.brand_logo} alt="" className="h-8 max-w-[96px] rounded bg-white/90 object-contain px-1" />
        ) : null}
        <div className="flex-1 truncate text-[15px] font-bold">{title}</div>
        <button
          onClick={() => setLbOpen(true)}
          className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white/20 text-base"
          title="Klassement"
        >
          🏆
        </button>
        <div className="rounded-full bg-teal-dark px-3 py-1.5 text-sm font-bold">
          <span>{score}</span> ptn
        </div>
        <button
          onClick={() => setShowIntro(true)}
          className="ml-1 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border-2 border-white/50 text-sm font-bold"
          title="Uitleg & signalen opnieuw bekijken"
        >
          ?
        </button>
      </header>

      {showIntro ? (
        <IntroScreen
          rally={state.rally}
          navModes={navModesUsed}
          onDone={() => {
            try {
              localStorage.setItem(`intro:${rallyId}`, "1");
            } catch {}
            setShowIntro(false);
          }}
        />
      ) : null}

      <div className="flex-1 p-4 pb-24">
        {geoDenied ? (
          <div className="mb-3 rounded-card bg-coral-light p-3 text-sm text-coral">
            📍 <b>Locatie staat uit.</b> Deze rally gebruikt je gps voor het ontgrendelen van opdrachten en het kompas.
            Zet locatietoegang aan in je browser en tik dan op &ldquo;opnieuw&rdquo;.
            <button className="btn btn-coral mt-2 w-full text-sm" onClick={requestLocation}>📍 Locatie opnieuw toestaan</button>
          </div>
        ) : null}
        {atFinish ? (
          <FinishView
            teamName={state.team.name}
            score={score}
            hintsUsed={state.events.filter((e) => e.is_hint).length}
            badges={badges}
            board={liveBoard}
          />
        ) : (
          <WaypointView
            key={flowPoints[step].id}
            point={flowPoints[step]}
            leg={legByPosition.get(flowPoints[step].position - 1)}
            assignment={assignmentByPoint.get(flowPoints[step].id)}
            stepIndex={step}
            total={flowPoints.length}
            completed={completed}
            testMode={testMode}
            onScored={onScored}
            toast={toast}
            onComplete={(aid) => aid && setCompleted((s) => new Set(s).add(aid))}
            onNext={() => setStep((s) => s + 1)}
            isLast={step === flowPoints.length - 1}
            nextLabel={
              flowPoints[step].kind === "finish"
                ? "🏁 Rally afronden"
                : flowPoints[step + 1]?.kind === "finish"
                  ? "Naar de finish →"
                  : "Volgende waypoint →"
            }
            finishName={finishPoint?.name ?? "de finish"}
            answeredEnroute={answeredEnroute}
            onEnrouteAnswered={(legId) => setAnsweredEnroute((s) => new Set(s).add(legId))}
          />
        )}
      </div>

      {lbOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-end bg-teal-dark/45"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLbOpen(false);
          }}
        >
          <div className="mx-auto max-h-[78%] w-full max-w-[520px] overflow-y-auto rounded-t-3xl bg-paper p-4">
            <h3 className="mb-3 text-lg font-bold text-teal-dark">🏆 Live klassement</h3>
            <LeaderboardList board={liveBoard} />
            <button className="btn btn-ghost w-full" onClick={() => setLbOpen(false)}>
              Sluiten
            </button>
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex flex-col items-center gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="toast" style={{ position: "static", transform: "none" }}>
            {t.msg}
          </div>
        ))}
      </div>
    </main>
  );
}

// ── one waypoint ─────────────────────────────────────────────────────────────
function WaypointView(props: {
  point: Point;
  leg?: Leg;
  assignment?: PublicAssignment;
  stepIndex: number;
  total: number;
  completed: Set<string>;
  testMode: boolean;
  onScored: (score: number, badge?: { name: string; icon: string }) => void;
  toast: (m: string) => void;
  onComplete: (assignmentId?: string) => void;
  onNext: () => void;
  isLast: boolean;
  nextLabel: string;
  finishName: string;
  answeredEnroute: Set<string>;
  onEnrouteAnswered: (legId: string) => void;
}) {
  const { point, leg, assignment, stepIndex, total, completed, testMode, onScored, toast, onComplete, onNext, nextLabel, answeredEnroute, onEnrouteAnswered } = props;
  // A speed test must be started at the beginning of the leg, so it isn't
  // arrival-gated like the other assignments.
  const gated = point.gps_unlock && assignment?.type !== "speed_test";
  const [unlocked, setUnlocked] = useState(!gated);
  const done = assignment ? completed.has(assignment.id) : true;
  // Puzzle navigation modes hide the destination: the point name + note would
  // otherwise reveal where to go, so keep them hidden until the team arrives.
  const hideDest = leg != null && ["turn", "routebook", "cryptic", "photo_nav", "dakar"].includes(leg.nav_mode);

  return (
    <div>
      <div className="progress">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={i < stepIndex ? "done" : i === stepIndex ? "cur" : ""} />
        ))}
      </div>

      {leg ? (
        <LegNav
          leg={leg}
          target={point}
          testMode={testMode}
          enrouteAnswered={answeredEnroute.has(leg.id)}
          onScored={onScored}
          toast={toast}
          onEnrouteAnswered={() => onEnrouteAnswered(leg.id)}
        />
      ) : null}

      {leg && (leg.nav_mode === "line" || ((leg.nav_mode === "turn" || leg.nav_mode === "dakar" || leg.nav_mode === "cryptic") && (leg.route_points ?? 0) > 0)) ? (
        <RouteScore leg={leg} target={point} testMode={testMode} onScored={onScored} toast={toast} />
      ) : null}

      {point.note && (unlocked || !gated) ? (
        <div className="mb-3.5 rounded-card bg-teal-light p-3 text-sm text-teal-dark">
          📍 <b>{point.name}</b> — {point.note}
        </div>
      ) : null}

      {!unlocked && gated ? (
        <GpsUnlock
          point={point}
          testMode={testMode}
          // hide the countdown for puzzle modes (spoils it) and for compass
          // (the compass already shows the distance) — the manual button stays.
          hideDistance={hideDest || leg?.nav_mode === "compass"}
          onUnlock={() => setUnlocked(true)}
          toast={toast}
        />
      ) : null}

      {assignment && !unlocked && gated ? (
        // Locked: never preview the task — it can reveal the destination.
        <div className="card border-l-4 border-polder-line text-center text-sm text-polder-grey">
          🔒 De opdracht verschijnt zodra je op de bestemming bent.
        </div>
      ) : assignment ? (
        <AssignmentCard
          assignment={assignment}
          done={done}
          testMode={testMode}
          onScored={onScored}
          toast={toast}
          onComplete={() => onComplete(assignment.id)}
        />
      ) : (
        <div className="card border-l-4 border-teal">
          <p className="text-sm text-polder-grey">Dit is een navigatiepunt — er is hier geen opdracht. Ga door naar het volgende punt.</p>
        </div>
      )}

      {done ? (
        <button className="btn btn-coral mt-1.5 w-full" onClick={onNext}>
          {nextLabel}
        </button>
      ) : null}
    </div>
  );
}

function shuffleArr<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

// bearing (0..360, 0=N) from point a to point b
function bearingTo(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

// ── leg navigation (per mode) ────────────────────────────────────────────────
function LegNav({
  leg,
  target,
  testMode,
  enrouteAnswered,
  onScored,
  toast,
  onEnrouteAnswered,
}: {
  leg: Leg;
  target: Point;
  testMode: boolean;
  enrouteAnswered: boolean;
  onScored: (score: number) => void;
  toast: (m: string) => void;
  onEnrouteAnswered: () => void;
}) {
  const nav = NAV_BY_MODE[leg.nav_mode];

  // Let teams tick off roadbook steps they've passed (a memory aid, per device).
  const [checked, setChecked] = useState<Set<number>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`legcheck:${leg.id}`);
      if (raw) setChecked(new Set(JSON.parse(raw) as number[]));
    } catch {}
  }, [leg.id]);
  const toggle = (i: number) =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      try {
        localStorage.setItem(`legcheck:${leg.id}`, JSON.stringify([...n]));
      } catch {}
      return n;
    });
  const checkDot = (i: number) => (
    <span className={`ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${checked.has(i) ? "border-teal bg-teal text-white" : "border-polder-line text-transparent"}`}>✓</span>
  );

  return (
    <div className="card mb-3.5 border-l-4 border-teal">
      <h3 className="mb-2 text-base font-bold text-teal-dark">
        {nav.icon} {nav.label.split(" (")[0]}
      </h3>

      {["turn", "routebook", "dakar"].includes(leg.nav_mode) && (leg.turn_steps ?? []).length > 0 ? (
        <p className="mb-2 text-[11px] text-polder-grey">Tik een stap aan om &apos;m af te vinken zodra je &apos;m gepasseerd bent.</p>
      ) : null}

      {leg.nav_mode === "compass" ? <LiveCompass target={target} testMode={testMode} /> : null}

      {leg.nav_mode === "routebook" ? (
        (leg.turn_steps ?? []).length > 0 ? (
          <ol className="space-y-2">
            {leg.turn_steps.map((s, i) => {
              const d = ROADBOOK_BY_ID[s.dir] ?? ROADBOOK_BY_ID.straight;
              const last = i === leg.turn_steps.length - 1;
              return (
                <li key={i} onClick={() => toggle(i)} className={`flex cursor-pointer items-start gap-3 rounded-soft border-2 border-polder-line bg-white p-2.5 ${checked.has(i) ? "opacity-60" : ""}`}>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal text-xs font-bold text-white">{i + 1}</span>
                  <div className="flex-1">
                    <div className={`font-semibold text-ink ${checked.has(i) ? "line-through" : ""}`}>{s.note || (last ? "Je bent op de bestemming" : d.label)}</div>
                    <div className="text-[13px] text-polder-grey">
                      <span className="mr-1">{d.icon}</span>
                      na {s.dist >= 1000 ? `${(s.dist / 1000).toFixed(1)} km` : `${s.dist} m`}
                    </div>
                  </div>
                  {checkDot(i)}
                </li>
              );
            })}
          </ol>
        ) : (
          <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed">
            {(leg.steps ?? "").split("\n").filter(Boolean).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )
      ) : null}

      {leg.nav_mode === "turn" ? (
        (leg.turn_steps ?? []).length > 0 ? (
          <div className="space-y-2">
            {leg.turn_steps.map((s, i) => {
              const d = ROADBOOK_BY_ID[s.dir] ?? ROADBOOK_BY_ID.straight;
              return (
                <div key={i} onClick={() => toggle(i)} className={`flex cursor-pointer items-center gap-3 rounded-soft border-2 border-polder-line bg-white p-2.5 ${checked.has(i) ? "opacity-60" : ""}`}>
                  <span className="shrink-0 rounded-soft bg-paper p-0.5"><TulipGlyph dir={s.dir} roads={s.roads} take={s.take} /></span>
                  <div className="flex-1">
                    <div className={`font-bold text-teal-dark ${checked.has(i) ? "line-through" : ""}`}>
                      {s.dist ? `Na ${s.dist >= 1000 ? `${(s.dist / 1000).toFixed(1)} km` : `${s.dist} m`}: ` : ""}{d.label}
                    </div>
                    {s.note ? <div className="text-[13px] text-polder-grey">{s.note}</div> : null}
                  </div>
                  {checkDot(i)}
                </div>
              );
            })}
          </div>
        ) : (
          // fall back to the old free-text steps
          <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed">
            {(leg.steps ?? "").split("\n").filter(Boolean).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )
      ) : null}

      {/* Roadbook (Dakar): trip odometer + a list of bold-arrow cases with pictos */}
      {leg.nav_mode === "dakar" ? (
        <div className="space-y-2">
          <TripOdometer />
          {(leg.turn_steps ?? []).length > 0 ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-3 px-2 text-[10px] font-semibold uppercase tracking-wide text-polder-grey">
                <span className="w-14 shrink-0 text-right leading-tight">km totaal<br /><span className="normal-case text-teal-dark">+ tussen</span></span>
                <span>richting &amp; herkenningspunt</span>
              </div>
              {(() => {
                let cum = 0;
                return leg.turn_steps.map((s, i) => {
                  cum += s.dist || 0;
                  const total = cum;
                  const last = i === leg.turn_steps.length - 1;
                  const d = ROADBOOK_BY_ID[s.dir] ?? ROADBOOK_BY_ID.straight;
                  return (
                    <div key={i} onClick={() => toggle(i)} className={`flex cursor-pointer items-center gap-3 rounded-soft border-2 border-polder-line bg-white p-2 ${checked.has(i) ? "opacity-60" : ""}`}>
                      <div className="w-14 shrink-0 text-right" title="Boven: totale km vanaf begin traject · Onder: km sinds vorige regel (vergelijk met je ritmeter)">
                        <div className="font-mono text-[15px] font-bold tabular-nums text-ink">{(total / 1000).toFixed(1)}</div>
                        <div className="font-mono text-[10px] font-semibold tabular-nums text-teal-dark">+{s.dist >= 1000 ? `${(s.dist / 1000).toFixed(1)}` : `${(s.dist / 1000).toFixed(2)}`}</div>
                      </div>
                      <span className="shrink-0 rounded-soft bg-paper p-0.5"><RoadArrowGlyph dir={s.dir} roads={s.roads} take={s.take} /></span>
                      {s.picto ? <span className="shrink-0 text-teal-dark"><Picto id={s.picto} size={30} /></span> : null}
                      <div className="min-w-0 flex-1">
                        <div className={`font-bold text-teal-dark ${checked.has(i) ? "line-through" : ""}`}>{s.note || (last ? "Aankomst" : d.label)}</div>
                        {s.danger ? <span className="mt-0.5 inline-block rounded bg-coral-light px-1.5 py-0.5 text-[11px] font-bold text-coral">{DANGER_LABEL[s.danger]}</span> : null}
                      </div>
                      {checkDot(i)}
                    </div>
                  );
                });
              })()}
            </div>
          ) : (
            <p className="text-sm text-polder-grey">Dit roadbook is nog niet ingevuld.</p>
          )}
        </div>
      ) : null}

      {/* Cryptische route: one clue at a time; must reach the spot to reveal the next */}
      {leg.nav_mode === "cryptic" ? <SequentialNav variant="cryptic" leg={leg} testMode={testMode} onScored={onScored} toast={toast} /> : null}

      {/* Foto-navigatie: one photo at a time; geofence-confirm arrival to advance */}
      {leg.nav_mode === "photo_nav" ? <SequentialNav variant="photo" leg={leg} testMode={testMode} onScored={onScored} toast={toast} /> : null}

      {leg.nav_mode === "line" ? <LineNav leg={leg} target={target} /> : null}

      {leg.nav_mode === "map" ? (
        <p className="text-sm leading-relaxed text-polder-grey">
          🗺️ {leg.note || "Volg de routelijn op de kaart naar het volgende punt."}
        </p>
      ) : null}

      {leg.enroute_enabled ? (
        <EnrouteQuestion
          leg={leg}
          answered={enrouteAnswered}
          onScored={onScored}
          toast={toast}
          onAnswered={onEnrouteAnswered}
        />
      ) : null}
    </div>
  );
}

// ── de harde lijn: read-only map (start/end/line), GPS does NOT guide ────────
function LineNav({ leg, target }: { leg: Leg; target: Point }) {
  const route = (leg.turn_route ?? []) as [number, number][];
  const start = route.length >= 1 ? { lat: route[0][0], lng: route[0][1] } : null;
  const end =
    target.lat != null && target.lng != null
      ? { lat: target.lat, lng: target.lng }
      : route.length >= 2
        ? { lat: route[route.length - 1][0], lng: route[route.length - 1][1] }
        : null;

  return (
    <div className="space-y-2">
      <p className="rounded-soft bg-amber-50 p-2 text-[13px] font-medium text-amber-800">
        🗺️ Ouderwets kaartlezen: volg de paarse lijn van <b>S</b> naar <b>F</b>. Je gps loopt hier <b>niet</b> mee — je moet zelf de kaart lezen. Achteraf kijken we met gps hoeveel van de route je gevolgd hebt.
      </p>
      {leg.note ? <p className="text-[13px] text-polder-grey">{leg.note}</p> : null}
      {start || end ? (
        <RouteLineMap start={start} end={end} route={route} />
      ) : (
        <p className="text-sm text-polder-grey">Er is nog geen lijn getekend voor dit traject.</p>
      )}
    </div>
  );
}

// Compute + show the route-following score once the team reaches the endpoint,
// with a feedback map comparing the route they had to drive against their trail.
function RouteScore({
  leg,
  target,
  testMode,
  onScored,
  toast,
}: {
  leg: Leg;
  target: Point;
  testMode: boolean;
  onScored: (score: number) => void;
  toast: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    coverage: number;
    awarded: number;
    maxPoints: number;
    route: [number, number][];
    trail: [number, number][];
  } | null>(null);
  // Strict GPS gate: scoring is only possible once the team is actually within
  // the destination radius (a real gps fix — the manual "we're here" override
  // does NOT unlock it), so a team can't lock in a low score before finishing.
  const noCoords = target.lat == null || target.lng == null;
  const [arrived, setArrived] = useState(testMode || noCoords);
  const [dist, setDist] = useState<number | null>(null);
  const radius = target.unlock_radius || 50;

  useEffect(() => {
    if (arrived || noCoords || !("geolocation" in navigator)) return;
    const t = { lat: target.lat as number, lng: target.lng as number };
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const d = haversine({ lat: pos.coords.latitude, lng: pos.coords.longitude }, t);
        setDist(Math.round(d));
        if (d <= Math.max(radius, (pos.coords.accuracy || 0) * 0.6)) {
          navigator.geolocation.clearWatch(id);
          setArrived(true);
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived, noCoords]);

  async function run() {
    setBusy(true);
    const r = await scoreRoute(leg.id);
    setBusy(false);
    if (!r.ok) {
      toast(r.error ?? "Kon de route niet scoren.");
      return;
    }
    setResult({ coverage: r.coverage, awarded: r.awarded, maxPoints: r.maxPoints, route: r.route, trail: r.trail });
    onScored(r.score);
    if (!r.already) toast(`Route gevolgd: ${Math.round(r.coverage * 100)}% → +${r.awarded} punten`);
  }

  const route = result?.route ?? [];
  const start = route.length >= 1 ? { lat: route[0][0], lng: route[0][1] } : null;
  const end =
    target.lat != null && target.lng != null
      ? { lat: target.lat, lng: target.lng }
      : route.length >= 2
        ? { lat: route[route.length - 1][0], lng: route[route.length - 1][1] }
        : null;

  return (
    <div className="card mb-3.5 border-l-4 border-teal">
      <h3 className="mb-1 text-base font-bold text-teal-dark">📐 Route-score</h3>
      {result ? (
        <div className="space-y-2">
          <div>
            <div className="text-3xl font-extrabold text-teal-dark">{Math.round(result.coverage * 100)}%</div>
            <p className="text-sm text-polder-grey">
              gevolgd van de uitgezette lijn → <b>+{result.awarded}</b>
              {result.maxPoints ? ` van ${result.maxPoints}` : ""} punten
            </p>
          </div>
          {result.route.length >= 2 || result.trail.length >= 2 ? (
            <>
              <RouteLineMap start={start} end={end} route={result.route} trail={result.trail} height={260} />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-polder-grey">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-1 w-5 rounded" style={{ background: "#534AB7" }} /> uitgezette route
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-1 w-5 rounded" style={{ background: "#D85A30" }} /> jullie spoor
                </span>
              </div>
            </>
          ) : null}
        </div>
      ) : arrived ? (
        <>
          <p className="mb-2 text-[13px] text-polder-grey">
            Je bent op de bestemming. Bekijk hoeveel van de uitgezette route je gevolgd hebt — dat bepaalt je punten.
          </p>
          <button className="btn btn-teal w-full" disabled={busy} onClick={run}>
            {busy ? "Bezig…" : "Toon mijn route-score"}
          </button>
        </>
      ) : (
        <p className="text-[13px] text-polder-grey">
          🔒 Je route-score verschijnt zodra je écht op de bestemming bent{dist != null ? ` (nog ${dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${dist} m`})` : ""}. Volg eerst de route helemaal af.
        </p>
      )}
    </div>
  );
}

// ── roadbook (Dakar): live trip odometer the team drives on + manual reset ───
function TripOdometer() {
  const [km, setKm] = useState(0);
  const last = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const cur = { lat: p.coords.latitude, lng: p.coords.longitude };
        const acc = p.coords.accuracy || 0;
        // Only count movement on a decent fix; ignore jitter (<6 m) and GPS
        // teleports (>300 m between fixes).
        if (acc > 0 && acc <= 45 && last.current) {
          const d = haversine(last.current, cur);
          if (d > 6 && d < 300) setKm((k) => k + d / 1000);
        }
        last.current = cur;
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return (
    <div className="mb-2 flex items-center gap-3 rounded-card border-2 border-teal bg-white p-2.5">
      <div className="flex items-baseline gap-1">
        <span className="font-mono text-3xl font-bold tabular-nums text-teal-dark">{km.toFixed(1)}</span>
        <span className="text-xs text-polder-grey">km<span className="block text-[9px] font-bold uppercase tracking-wide">ritmeter</span></span>
      </div>
      <button
        className="ml-auto rounded-soft border-2 border-teal bg-teal-light px-3 py-2 text-[13px] font-bold text-teal-dark"
        onClick={() => { setKm(0); ensureAudio(); }}
      >
        ⟲ Reset op punt
      </button>
    </div>
  );
}

// ── game master: enters a secret code + the points earned on location ────────
function GameMasterInput({
  cfg,
  busy,
  send,
}: {
  cfg: Record<string, unknown>;
  busy: boolean;
  send: (s: Record<string, unknown>) => Promise<{ ok: boolean }>;
}) {
  const max = Number(cfg.max ?? 0);
  const [code, setCode] = useState("");
  const [pts, setPts] = useState<number>(0);
  return (
    <div className="space-y-2">
      <p className="rounded-soft bg-teal-light p-2 text-[13px] text-teal-dark">🧑‍⚖️ Geef het toestel aan de spelleider — die vult de code en de punten in.</p>
      <label className="field-label">Spelleiderscode</label>
      <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="code van de spelleider" autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false} />
      <label className="field-label">Punten{max ? ` (0–${max})` : ""}</label>
      <input type="number" min={0} max={max || undefined} className="input" value={pts} onChange={(e) => setPts(Number(e.target.value))} />
      <button className="btn btn-purple w-full" disabled={busy} onClick={() => send({ code: code.trim(), points: pts })}>
        {busy ? "Bezig…" : "Punten toekennen"}
      </button>
    </div>
  );
}

// ── foto-navigatie: one photo at a time; confirm arrival within 100 m ────────
const PHOTO_GEOFENCE_M = 100;

function SequentialNav({
  leg,
  variant,
  testMode,
  onScored,
  toast,
}: {
  leg: Leg;
  variant: "photo" | "cryptic";
  testMode: boolean;
  onScored: (score: number) => void;
  toast: (m: string) => void;
}) {
  const isPhoto = variant === "photo";
  const noun = isPhoto ? "foto" : "aanwijzing";
  const steps = leg.turn_steps ?? [];
  const pts = leg.turn_points ?? [];
  const legRadius = leg.photo_radius != null && leg.photo_radius > 0 ? leg.photo_radius : PHOTO_GEOFENCE_M;
  const cost = leg.photo_buy_cost != null && leg.photo_buy_cost > 0 ? leg.photo_buy_cost : NEXT_STEP_COST;
  const [idx, setIdx] = useState(0);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);

  // Restore progress so a reload doesn't send the team back to step 1.
  useEffect(() => {
    const v = Number(localStorage.getItem(`seqnav:${leg.id}`) || 0);
    if (v > 0) setIdx(v);
  }, [leg.id]);
  const save = (n: number) => {
    setIdx(n);
    try {
      localStorage.setItem(`seqnav:${leg.id}`, String(n));
    } catch {}
  };

  if (steps.length === 0) {
    return <p className="text-sm text-polder-grey">Nog geen {noun}en ingesteld voor dit traject.</p>;
  }

  if (idx >= steps.length) {
    return (
      <div className="rounded-soft bg-teal-light p-3 text-center text-sm text-teal-dark">
        {isPhoto ? "📷" : "🕵️"} Alle {noun}en gevonden! Ga nu naar de eindbestemming — de opdracht opent zodra je er bent.
      </div>
    );
  }

  const cur = steps[idx];
  const loc = pts[idx];
  const radius = cur.radius != null && cur.radius > 0 ? cur.radius : legRadius;

  function confirmHere() {
    ensureAudio(); // unlock audio on this tap (iOS)
    if (testMode) {
      arrivalFeedback("waypoint");
      toast(`🧪 Test: volgende ${noun} vrijgegeven.`);
      save(idx + 1);
      return;
    }
    if (!loc || loc.lat == null || loc.lng == null) {
      // no coordinates configured for this step → can't geofence, just advance
      save(idx + 1);
      return;
    }
    if (!("geolocation" in navigator)) {
      toast("📡 Geen gps beschikbaar op dit toestel.");
      return;
    }
    setChecking(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setChecking(false);
        const d = haversine({ lat: pos.coords.latitude, lng: pos.coords.longitude }, { lat: loc.lat as number, lng: loc.lng as number });
        // allow for gps inaccuracy but never reveal the distance to the player
        if (d <= Math.max(radius, pos.coords.accuracy || 0)) {
          arrivalFeedback("waypoint");
          toast(`📍 Goed gevonden — volgende ${noun}!`);
          save(idx + 1);
        } else {
          toast("🔍 Nog niet op de juiste plek — blijf zoeken.");
        }
      },
      () => {
        setChecking(false);
        toast("📡 Geen gps-fix — zet locatie aan en probeer opnieuw.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 1000 },
    );
  }

  async function buyNext() {
    setBusy(true);
    const r = await buyNextStep(leg.id);
    setBusy(false);
    if (r.error) {
      toast(r.error);
      return;
    }
    onScored(r.score);
    toast(`🛒 Volgende ${noun} vrijgekocht (−${cost}).`);
    save(idx + 1);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[13px] font-bold text-teal-dark">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs text-white ${isPhoto ? "bg-teal" : "bg-purple"}`}>{idx + 1}</span>
        {isPhoto ? "Foto" : "Aanwijzing"} {idx + 1} van {steps.length} — {isPhoto ? "zoek deze plek" : "los op en ga erheen"}
      </div>
      {isPhoto ? (
        cur.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cur.photo} alt={`Herkenningspunt ${idx + 1}`} className="w-full rounded-soft object-cover" />
        ) : (
          <div className="rounded-soft bg-paper p-4 text-center text-xs text-polder-grey">Geen foto ingesteld</div>
        )
      ) : (
        <div className="rounded-soft border-2 border-polder-line bg-white p-3 text-base font-semibold text-ink">{cur.note || "…"}</div>
      )}
      {isPhoto && cur.note ? <p className="text-[13px] text-polder-grey">{cur.note}</p> : null}
      <button className="btn-demo w-full" disabled={checking} onClick={confirmHere}>
        {checking ? "📡 Locatie controleren…" : "📍 We zijn er!"}
      </button>
      <button className="btn btn-ghost w-full text-sm" disabled={busy} onClick={buyNext}>
        {busy ? "Bezig…" : `🛒 Volgende ${noun} afkopen (−${cost} ptn)`}
      </button>
      <p className="text-[11px] text-polder-grey">Je moet binnen ±{radius} m van de plek staan. Kom je er niet uit? Koop de volgende {noun} af — kan alleen als je genoeg punten hebt.</p>
    </div>
  );
}

// ── live compass: bearing + distance from the team's live position, needle
//    that follows the phone's heading (turn until the arrow points up) ─────────
type OrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };
type DOEWithPerm = { requestPermission?: () => Promise<"granted" | "denied"> };

// Current screen rotation in degrees (for Android absolute-heading correction).
function screenAngle(): number {
  if (typeof window === "undefined") return 0;
  const a = window.screen?.orientation?.angle;
  if (typeof a === "number") return a;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === "number" ? legacy : 0;
}

function LiveCompass({ target, testMode }: { target: Point; testMode: boolean }) {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [acc, setAcc] = useState<number | null>(null); // gps accuracy (m)
  const [err, setErr] = useState(false);
  const [compass, setCompass] = useState<number | null>(null); // magnetometer heading
  const [gpsHeading, setGpsHeading] = useState<number | null>(null); // course over ground
  const [needPerm, setNeedPerm] = useState(false);
  const offRef = useRef<(() => void) | null>(null);
  const srcRef = useRef<null | "webkit" | "absolute">(null); // lock one heading source

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setErr(true);
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setErr(false);
        const a = p.coords.accuracy || 0;
        setAcc(Math.round(a));
        const fix = { lat: p.coords.latitude, lng: p.coords.longitude };
        // Use the latest fix; only reject an absurd one (km-scale) if we already
        // have a position — so a coarse fix never freezes or wildly swings us.
        setPos((prev) => (prev && a > 1000 ? prev : fix));
        // GPS course over ground = a heading that needs no magnetometer; use it
        // only as a fallback when the compass isn't available.
        const spd = p.coords.speed;
        const crs = p.coords.heading;
        if (typeof spd === "number" && spd >= 1.4 && typeof crs === "number" && !Number.isNaN(crs)) {
          setGpsHeading((crs + 360) % 360);
        }
      },
      () => setErr(true),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  function attachOrientation() {
    offRef.current?.(); // avoid duplicate listeners on re-activate
    const handler = (e: Event) => {
      const oe = e as OrientationEvent;
      const hasWebkit = typeof oe.webkitCompassHeading === "number" && !Number.isNaN(oe.webkitCompassHeading);
      // Lock to the FIRST usable source and ignore the other forever — mixing
      // iOS webkit heading with a relative/absolute alpha causes 180° flips.
      if (srcRef.current == null) srcRef.current = hasWebkit ? "webkit" : oe.absolute === true ? "absolute" : null;
      let h: number | null = null;
      if (srcRef.current === "webkit") {
        if (!hasWebkit) return;
        h = oe.webkitCompassHeading as number; // iOS true heading (0 = N, cw)
      } else if (srcRef.current === "absolute") {
        if (oe.absolute !== true || typeof oe.alpha !== "number") return;
        h = (360 - oe.alpha + screenAngle()) % 360; // Android absolute
      } else {
        return;
      }
      if (h == null || Number.isNaN(h)) return;
      const next = (h + 360) % 360;
      // circular low-pass smoothing so the arrow glides, without lagging too much
      setCompass((prev) => {
        if (prev == null) return next;
        const diff = ((next - prev + 540) % 360) - 180;
        return (prev + diff * 0.35 + 360) % 360;
      });
    };
    window.addEventListener("deviceorientationabsolute", handler, true);
    window.addEventListener("deviceorientation", handler, true);
    offRef.current = () => {
      window.removeEventListener("deviceorientationabsolute", handler, true);
      window.removeEventListener("deviceorientation", handler, true);
    };
  }

  useEffect(() => {
    const DOE = (window.DeviceOrientationEvent as unknown as DOEWithPerm) ?? null;
    if (DOE && typeof DOE.requestPermission === "function") {
      setNeedPerm(true); // iOS: needs a tap to grant
    } else if (typeof window !== "undefined" && "DeviceOrientationEvent" in window) {
      attachOrientation();
    }
    return () => offRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enableCompass() {
    const DOE = window.DeviceOrientationEvent as unknown as DOEWithPerm;
    try {
      if (typeof DOE?.requestPermission === "function") {
        // iOS: needs an explicit permission grant from this tap.
        const res = await DOE.requestPermission();
        if (res === "granted") {
          setNeedPerm(false);
          attachOrientation();
        }
      } else {
        // Android / others: no permission needed — (re)attach the listeners.
        attachOrientation();
      }
    } catch {
      /* ignore */
    }
  }

  const hasTarget = target.lat != null && target.lng != null;
  const bearing =
    pos && hasTarget ? (bearingTo(pos, { lat: target.lat!, lng: target.lng! }) + 360) % 360 : null;
  const distance =
    pos && hasTarget ? Math.round(haversine(pos, { lat: target.lat!, lng: target.lng! })) : null;

  // Heading: compass (magnetometer) is primary so N + arrow stay consistent
  // when you turn the phone; GPS course is only a fallback when there's no
  // compass reading (e.g. permission not granted but you're moving).
  const usingGps = compass == null && gpsHeading != null;
  const heading = compass != null ? compass : gpsHeading;

  // Arrow points to the target relative to that heading (up = go this way).
  const hasHeading = heading != null;
  const targetRot = hasHeading && bearing != null ? (bearing - heading! + 360) % 360 : bearing ?? 0;
  const pointingUp = hasHeading && bearing != null && Math.abs(((targetRot + 180) % 360) - 180) < 18;
  const northRot = hasHeading ? (-heading! + 360) % 360 : 0;
  // A coarse fix (>150 m, i.e. network/cell location) makes the direction
  // meaningless — almost always iOS "Precise Location" being off for the site.
  const coarse = acc != null && acc > 150;

  return (
    <div className="flex flex-col items-center py-1.5">
      <div className={`relative flex h-44 w-44 items-center justify-center rounded-full border-2 ${pointingUp ? "border-teal bg-teal-light" : "border-polder-line bg-paper"}`}>
        {/* fixed reference: the top of the dial = the way you face / drive */}
        <div className="absolute -top-1 text-[10px] font-bold text-polder-grey">▲ voor je</div>

        {/* compass ring: N/E/S/W rotate so N points to real north */}
        <div
          className="absolute inset-2 rounded-full"
          style={{ transform: `rotate(${northRot}deg)`, transition: "transform .2s ease" }}
        >
          <span className="absolute left-1/2 top-0 -translate-x-1/2 text-xs font-bold text-coral">N</span>
          <span className="absolute left-1/2 bottom-0 -translate-x-1/2 text-[11px] font-bold text-polder-grey">Z</span>
          <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[11px] font-bold text-polder-grey">W</span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[11px] font-bold text-polder-grey">O</span>
        </div>

        {/* target arrow: points toward the destination (dimmed if gps is coarse) */}
        {bearing != null ? (
          <svg
            viewBox="0 0 100 100"
            className={`h-32 w-32 ${coarse ? "opacity-30" : ""}`}
            style={{ transform: `rotate(${targetRot}deg)`, transition: "transform .2s ease" }}
          >
            <path d="M50 10 L70 60 L50 50 L30 60 Z" fill={pointingUp ? "#1D9E75" : "#D85A30"} />
          </svg>
        ) : (
          <div className="text-4xl">🧭</div>
        )}
      </div>

      <div className="mt-3 text-center">
        <b className="block text-[26px] text-coral">
          {distance != null ? (distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${distance} m`) : "—"}
        </b>
        <span className="text-sm text-polder-grey">tot het punt</span>
      </div>

      {/* gps quality — safe to show (no coordinates leaked) */}
      <p className="mt-1 text-center text-[11px] text-polder-grey">
        gps {acc != null ? (acc >= 1000 ? `±${(acc / 1000).toFixed(1)} km` : `±${acc} m`) : "—"}
      </p>
      {/* raw diagnostics (incl. coordinates) ONLY in test mode — players must
          not see the target coordinates or they could copy them into Maps */}
      {testMode ? (
        <p className="mt-0.5 text-center text-[10px] text-polder-grey/80">
          koers {heading != null ? `${Math.round(heading)}°` : "—"} ({usingGps ? "gps" : "kompas"})
          {" · "}doel {bearing != null ? `${Math.round(bearing)}°` : "—"}
          {" · "}jij {pos ? `${pos.lat.toFixed(4)},${pos.lng.toFixed(4)}` : "—"} → {hasTarget ? `${target.lat!.toFixed(4)},${target.lng!.toFixed(4)}` : "—"}
        </p>
      ) : null}

      {coarse ? (
        <div className="mt-2 rounded-soft bg-coral-light p-2.5 text-[12px] text-coral">
          📡 <b>Je locatie is te grof (±{acc && acc >= 1000 ? `${(acc / 1000).toFixed(1)} km` : `${acc} m`})</b>, dus de richting klopt nog niet. Zet <b>nauwkeurige locatie</b> aan:
          <span className="mt-1 block text-[11px] text-polder-grey">
            iPhone: Instellingen → Privacy &amp; beveiliging → Locatievoorzieningen → Safari → <b>Nauwkeurige locatie AAN</b>. Android: Chrome → siterechten → Locatie → <b>Nauwkeurig</b>. Ga daarna naar buiten met vrij zicht.
          </span>
        </div>
      ) : hasHeading ? (
        <p className="mt-1 text-center text-xs font-semibold text-polder-grey">
          {pointingUp ? "Goed zo — recht vooruit! ✅" : "Draai/rijd tot de gekleurde pijl naar boven (▲) wijst."}
        </p>
      ) : (
        <button className="btn btn-primary mt-2 w-full" onClick={enableCompass}>
          🧭 Kompas activeren / ijken
        </button>
      )}
      <button onClick={enableCompass} className="mt-1 text-[11px] text-polder-grey underline">
        kompas opnieuw ijken
      </button>
    </div>
  );
}

// ── en-route question (graded when points > 0, social at 0 points) ───────────
function EnrouteQuestion({
  leg,
  answered,
  onScored,
  toast,
  onAnswered,
}: {
  leg: Leg;
  answered: boolean;
  onScored: (score: number) => void;
  toast: (m: string) => void;
  onAnswered: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const social = leg.enroute_points <= 0;

  async function submit() {
    setBusy(true);
    const r = await answerEnroute(leg.id, text);
    setBusy(false);
    if (r.error) return toast(r.error);
    setFeedback({ ok: r.ok, msg: r.feedback });
    onScored(r.score);
    if (r.complete) onAnswered();
  }

  return (
    <div className={`mt-2.5 rounded-soft p-2.5 ${social ? "bg-purple-light" : "bg-white border-[1.5px] border-purple"}`}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-bold text-purple">❓ Onderwegvraag</span>
        {social ? (
          <span className="chip">💚 Kennismaken</span>
        ) : (
          <>
            <span className="chip">+{leg.enroute_points} punten</span>
            <span className="chip chip-teal">AUTO</span>
          </>
        )}
      </div>
      <p className="mb-2 text-sm font-semibold">{leg.enroute_question}</p>

      {answered || feedback?.ok ? (
        <div className={social ? "feedback-ok" : "feedback-ok"}>
          {social ? "💚 Bedankt voor het delen!" : "✅ Beantwoord!"}
        </div>
      ) : (
        <div className="space-y-2">
          <input
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={social ? "Deel jullie antwoord…" : "Jullie antwoord"}
          />
          {feedback && !feedback.ok ? <div className="feedback-err">{feedback.msg}</div> : null}
          <button className="btn btn-purple w-full" disabled={busy || (social && !text.trim())} onClick={submit}>
            {social ? "Delen 💚" : "Antwoord indienen"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── GPS unlock (real geolocation with a labelled demo fallback) ──────────────
function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Continuously watches the team's position and auto-unlocks the assignment when
// they arrive within the point's unlock radius — like reaching a roadbook point.
function GpsUnlock({ point, testMode, hideDistance, onUnlock, toast }: { point: Point; testMode: boolean; hideDistance: boolean; onUnlock: () => void; toast: (m: string) => void }) {
  const [dist, setDist] = useState<number | null>(null);
  const [err, setErr] = useState(false);
  const [checking, setChecking] = useState(false);
  const radius = point.unlock_radius || 50;

  useEffect(() => {
    if (point.lat == null || point.lng == null) {
      // no coordinates configured → nothing to gate on, open it
      onUnlock();
      return;
    }
    if (!("geolocation" in navigator)) {
      setErr(true);
      return;
    }
    const target = { lat: point.lat, lng: point.lng };
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setErr(false);
        const d = haversine({ lat: pos.coords.latitude, lng: pos.coords.longitude }, target);
        setDist(Math.round(d));
        // allow for gps inaccuracy so it reliably triggers on arrival
        if (d <= Math.max(radius, (pos.coords.accuracy || 0) * 0.6)) {
          navigator.geolocation.clearWatch(id);
          arrivalFeedback("assignment");
          toast("📍 Locatie bereikt — opdracht ontgrendeld!");
          onUnlock();
        }
      },
      () => setErr(true),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Manual "we think we're here" check: verify the current position on demand.
  function checkHere() {
    ensureAudio(); // this tap unlocks audio playback (needed on iOS)
    if (testMode) {
      arrivalFeedback("assignment");
      onUnlock();
      return;
    }
    if (point.lat == null || point.lng == null) {
      onUnlock();
      return;
    }
    if (!("geolocation" in navigator)) {
      toast("📡 Geen gps beschikbaar op dit toestel.");
      return;
    }
    setChecking(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setChecking(false);
        const d = haversine({ lat: pos.coords.latitude, lng: pos.coords.longitude }, { lat: point.lat as number, lng: point.lng as number });
        setDist(Math.round(d));
        if (d <= Math.max(radius, pos.coords.accuracy || 0)) {
          arrivalFeedback("assignment");
          toast("📍 Op de plek — de vraag is ontgrendeld!");
          onUnlock();
        } else {
          const shown = d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
          toast(`🔍 Nog ${shown} van het punt (±${Math.round(pos.coords.accuracy || 0)} m gps) — volg de navigatie verder.`);
        }
      },
      () => {
        setChecking(false);
        toast("📡 Geen gps-fix — zet locatie aan en probeer opnieuw.");
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }, // force a fresh fix
    );
  }

  return (
    <div className="mb-3">
      <div className="mb-2.5 flex items-center gap-2 rounded-soft bg-coral-light p-2.5 text-[13px] font-bold text-coral">
        🔒 Opdracht vergrendeld — hij opent zodra je op de bestemming bent.
      </div>
      {!hideDistance && dist != null ? (
        <div className="mb-2 rounded-soft bg-teal-light p-3 text-center">
          <div className="text-3xl font-bold text-teal-dark">
            {dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${dist} m`}
          </div>
          <p className="text-[13px] text-polder-grey">tot het punt — blijf navigeren 🧭</p>
        </div>
      ) : (
        <p className="mb-2 text-center text-[13px] text-polder-grey">
          {err ? "📡 Geen gps. Zet locatie aan (of gebruik testmodus)." : "Volg de navigatie — tik op de knop als je denkt dat je er bent."}
        </p>
      )}
      <button className="btn-demo w-full" disabled={checking} onClick={checkHere}>
        {checking ? "📡 Locatie controleren…" : "📍 We zijn er! — controleer locatie"}
      </button>
      {testMode ? (
        <button className="btn btn-ghost mt-2 w-full text-sm" onClick={onUnlock}>
          🧪 Test: locatie bereikt
        </button>
      ) : null}
    </div>
  );
}

// ── average-speed test: measured by GPS (start → arrival) ────────────────────
function SpeedTest({
  cfg,
  busy,
  testMode,
  send,
}: {
  cfg: Record<string, unknown>;
  busy: boolean;
  testMode: boolean;
  send: (s: Record<string, unknown>) => Promise<{ ok: boolean }>;
}) {
  const target = Number(cfg.target ?? 30);
  const courseM = Math.max(0, Number(cfg.distanceM ?? 0)); // 0 = manual finish
  const [phase, setPhase] = useState<"idle" | "measuring">("idle");
  const [distM, setDistM] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [curSpeed, setCurSpeed] = useState<number | null>(null); // instantaneous gps km/h
  const watchRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const lastRef = useRef<{ lat: number; lng: number } | null>(null);
  const distRef = useRef(0);
  const doneRef = useRef(false);
  const [testVal, setTestVal] = useState<number>(target);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
  };
  useEffect(() => () => stop(), []);

  const avg = elapsed > 0 ? (distM / 1000) / (elapsed / 3600) : 0;

  function submit(measured: number) {
    if (doneRef.current) return;
    doneRef.current = true;
    stop();
    send({ value: Math.round(measured) });
  }

  function start() {
    if (!("geolocation" in navigator)) return;
    setPhase("measuring");
    doneRef.current = false;
    startRef.current = Date.now();
    distRef.current = 0;
    lastRef.current = null;
    setDistM(0);
    setElapsed(0);
    intervalRef.current = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 1000);
    watchRef.current = navigator.geolocation.watchPosition(
      (p) => {
        const cur = { lat: p.coords.latitude, lng: p.coords.longitude };
        if (lastRef.current) distRef.current += haversine(lastRef.current, cur);
        lastRef.current = cur;
        setDistM(Math.round(distRef.current));
        const sp = p.coords.speed; // GPS speed (m/s) → km/h; hide the average
        setCurSpeed(sp != null && sp >= 0 ? Math.round(sp * 3.6) : null);
        // auto-finish once the configured course length is covered → everyone
        // is judged over the same distance.
        if (courseM > 0 && distRef.current >= courseM) {
          const secs = (Date.now() - startRef.current) / 1000;
          const a = secs > 0 ? (courseM / 1000) / (secs / 3600) : 0;
          submit(a);
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
  }

  const pct = courseM > 0 ? Math.min(100, Math.round((distM / courseM) * 100)) : 0;

  return (
    <div className="space-y-2">
      <p className="text-[13px] text-polder-grey">
        Doel: gemiddeld <b className="text-coral">{target} km/u</b>
        {courseM > 0 ? <> over <b>{courseM >= 1000 ? `${(courseM / 1000).toFixed(1)} km` : `${courseM} m`}</b></> : null}. Druk op start aan het begin van het traject; de gps meet je gemiddelde{courseM > 0 ? " en stopt automatisch op het eindpunt" : " tot je op het eindpunt drukt"}.
      </p>
      {phase === "idle" ? (
        <button className="btn btn-primary w-full" disabled={busy} onClick={start}>▶️ Start meten</button>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-soft bg-teal-light p-2"><b className="block text-lg text-teal-dark">{(distM / 1000).toFixed(2)}</b><span className="text-[11px] text-polder-grey">km</span></div>
            <div className="rounded-soft bg-teal-light p-2"><b className="block text-lg text-teal-dark">{Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, "0")}</b><span className="text-[11px] text-polder-grey">tijd</span></div>
            <div className="rounded-soft bg-teal-light p-2"><b className="block text-lg text-coral">{curSpeed != null ? curSpeed : "—"}</b><span className="text-[11px] text-polder-grey">km/u nu (gps)</span></div>
          </div>
          <p className="text-center text-[11px] text-polder-grey">Je gemiddelde zie je pas na afloop — houd de doelsnelheid aan op je snelheidsmeter.</p>
          {courseM > 0 ? (
            <div>
              <div className="h-2 overflow-hidden rounded bg-polder-line"><i className="block h-full rounded bg-coral" style={{ width: `${pct}%` }} /></div>
              <p className="mt-0.5 text-center text-[11px] text-polder-grey">{distM} van {courseM} m — stopt automatisch op het eindpunt</p>
            </div>
          ) : null}
          <button className="btn btn-coral w-full" disabled={busy} onClick={() => submit(avg)}>🏁 Eindpunt bereikt — dien nu in</button>
        </div>
      )}
      {testMode ? (
        <div className="rounded-soft border border-dashed border-[#C9A227] p-2">
          <p className="mb-1 text-[11px] font-bold text-[#7A5D00]">🧪 Test: kies een gemiddelde</p>
          <input type="range" min={Math.max(5, target - 25)} max={target + 25} value={testVal} onChange={(e) => setTestVal(Number(e.target.value))} className="w-full accent-coral" />
          <button className="btn-demo mt-1" disabled={busy} onClick={() => send({ value: testVal })}>🧪 Simuleer {testVal} km/u</button>
        </div>
      ) : null}
    </div>
  );
}

// ── assignment card (dispatches per building block) ──────────────────────────
function AssignmentCard({
  assignment,
  done,
  testMode,
  onScored,
  toast,
  onComplete,
}: {
  assignment: PublicAssignment;
  done: boolean;
  testMode: boolean;
  onScored: (score: number, badge?: { name: string; icon: string }) => void;
  toast: (m: string) => void;
  onComplete: () => void;
}) {
  const def = BLOCK_BY_TYPE[assignment.type];
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [hintText, setHintText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cfg = assignment.public_config as Record<string, unknown>;

  async function send(submission: Record<string, unknown>) {
    setBusy(true);
    const r = await submitAnswer(assignment.id, submission);
    setBusy(false);
    if (r.error) {
      toast(r.error);
      return r;
    }
    setFeedback({ ok: r.ok, msg: r.feedback });
    onScored(r.score, r.badge);
    if (r.complete) onComplete();
    return r;
  }

  // Submit with an optional proof photo (uploads to Storage server-side).
  async function sendForm(submission: Record<string, unknown>, file?: File | null) {
    setBusy(true);
    const fd = new FormData();
    fd.set("submission", JSON.stringify(submission));
    if (file) {
      const blob = await downscale(file);
      fd.set("photo", blob, "proof.jpg");
    }
    const r = await submitAnswerWithPhoto(assignment.id, fd);
    setBusy(false);
    if (r.error) {
      toast(r.error);
      return r;
    }
    setFeedback({ ok: r.ok, msg: r.feedback });
    onScored(r.score, r.badge);
    if (r.complete) onComplete();
    return r;
  }

  // Upload a video straight to Storage (signed URL) — bypasses the action size
  // limit — then record + grade it.
  async function sendVideo(file: File) {
    // Reject clips longer than the configured max (tolerance for recorder overshoot).
    const maxSec = Number(cfg.maxSec) > 0 ? Number(cfg.maxSec) : MAX_VIDEO_SEC;
    const dur = await videoDuration(file);
    if (dur > maxSec + 1) {
      toast(`🎥 Filmpje is te lang (${Math.round(dur)}s). Maximaal ${maxSec} seconden — neem een korter filmpje op.`);
      return;
    }
    const m = file.name.match(/\.([a-z0-9]+)$/i);
    const ext = m ? m[1].toLowerCase() : file.type.includes("webm") ? "webm" : file.type.includes("quicktime") ? "mov" : "mp4";
    setBusy(true);
    toast("🎥 Filmpje uploaden…");
    const prep = await createMediaUploadUrl(assignment.id, ext);
    if (!prep.ok || !prep.path || !prep.token || !prep.bucket) {
      setBusy(false);
      toast(prep.error ?? "Upload mislukt.");
      return;
    }
    const supabase = createClient();
    const { error: upErr } = await supabase.storage
      .from(prep.bucket)
      .uploadToSignedUrl(prep.path, prep.token, file, { contentType: file.type || "video/mp4" });
    if (upErr) {
      setBusy(false);
      toast("Uploaden mislukt — controleer je verbinding en probeer opnieuw.");
      return;
    }
    const r = await submitMedia(assignment.id, prep.path);
    setBusy(false);
    if (r.error) {
      toast(r.error);
      return;
    }
    setFeedback({ ok: r.ok, msg: r.feedback });
    onScored(r.score, r.badge);
    if (r.complete) onComplete();
  }

  async function doHint() {
    setBusy(true);
    const r = await useHint(assignment.id);
    setBusy(false);
    if (r.error) return toast(r.error);
    setHintText(r.hintText ?? "");
    onScored(r.score);
  }

  return (
    <div className="card mb-3.5 border-l-4 border-purple bg-purple-light">
      <h3 className="mb-2 text-base font-bold text-purple">
        {def.icon} {def.label}
      </h3>
      <div className="mb-2.5 flex flex-wrap gap-2">
        <span className="chip">{assignment.grading === "scale" ? `Max +${assignment.points}` : `+${assignment.points} punten`}</span>
        {assignment.hint_mode === "cost" ? <span className="chip">Hint −{assignment.hint_cost}</span> : null}
        {assignment.hint_mode === "free" ? <span className="chip">Hint gratis</span> : null}
        <span className="chip chip-teal">{GRADING_LABEL[def.grading]}</span>
      </div>
      {assignment.prompt ? <p className="mb-2.5 font-bold">{assignment.prompt}</p> : null}

      {!done ? (
        <TypeBody type={assignment.type} assignmentId={assignment.id} cfg={cfg} busy={busy} testMode={testMode} send={send} sendForm={sendForm} sendVideo={sendVideo} toast={toast} />
      ) : null}

      {done && assignment.type === "code_breaker" ? (
        <div className="my-2 flex flex-col items-center">
          <div className="lock-open text-6xl leading-none">🔓</div>
          <p className="mt-1 text-sm font-bold text-teal-dark">Klik! Het slot springt open.</p>
        </div>
      ) : null}

      {feedback ? (
        <div className={feedback.ok ? "feedback-ok mt-2.5" : "feedback-err mt-2.5"}>{feedback.msg}</div>
      ) : null}

      {/* Hint (all types except code_breaker, which has its own two-step help) */}
      {!done && assignment.type !== "code_breaker" && assignment.hint_mode !== "off" && hintText === null ? (
        <button className="btn btn-ghost mt-2 w-full" onClick={doHint} disabled={busy}>
          💡 Hint gebruiken {assignment.hint_mode === "cost" ? `(−${assignment.hint_cost} ptn)` : "(gratis)"}
        </button>
      ) : null}
      {hintText !== null ? <div className="hint-box">💡 {hintText}</div> : null}

      {/* Code breaker two-step help */}
      {!done && assignment.type === "code_breaker" ? (
        <CodeBreakerHelp
          assignment={assignment}
          hintUsed={hintText !== null}
          onHint={doHint}
          onScored={onScored}
          toast={toast}
        />
      ) : null}

      {assignment.type === "photo_search" || assignment.type === "free_game" || assignment.type === "video_task" ? (
        <p className="mt-2 text-xs text-polder-grey">De organisator kan dit na afloop bekijken en punten corrigeren.</p>
      ) : null}
    </div>
  );
}

// ── per-type interaction ─────────────────────────────────────────────────────
function TypeBody({
  type,
  assignmentId,
  cfg,
  busy,
  testMode,
  send,
  sendForm,
  sendVideo,
  toast,
}: {
  type: PublicAssignment["type"];
  assignmentId: string;
  cfg: Record<string, unknown>;
  busy: boolean;
  testMode: boolean;
  send: (s: Record<string, unknown>) => Promise<{ ok: boolean }>;
  sendForm: (s: Record<string, unknown>, file?: File | null) => Promise<{ ok: boolean }>;
  sendVideo: (file: File) => Promise<void>;
  toast: (m: string) => void;
}) {
  const [text, setText] = useState("");
  const [value, setValue] = useState<number>(Number(cfg.target ?? 0));
  const [disabledSigns, setDisabledSigns] = useState<Set<string>>(new Set());
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [orderList, setOrderList] = useState<string[]>(() => shuffleArr((cfg.items as string[]) ?? []));
  const [scan, setScan] = useState<null | "checkpoint" | "search">(null);

  switch (type) {
    case "multiple_choice": {
      const options = (cfg.options as { id: string; label: string }[]) ?? [];
      return (
        <div className="space-y-2">
          {options.map((o) => (
            <button
              key={o.id}
              disabled={busy}
              onClick={() => send({ choice: o.id })}
              className="block w-full rounded-soft border-2 border-polder-line bg-white p-3 text-left font-semibold hover:border-purple"
            >
              {o.id} · {o.label}
            </button>
          ))}
        </div>
      );
    }

    case "open_question":
    case "observation":
      return (
        <div className="space-y-2">
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Jullie antwoord" />
          <button className="btn btn-purple w-full" disabled={busy} onClick={() => send({ text })}>
            Antwoord indienen
          </button>
        </div>
      );

    case "estimation":
      return (
        <div className="space-y-2">
          <input
            type="number"
            className="input"
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            placeholder="Jullie schatting"
          />
          <button className="btn btn-purple w-full" disabled={busy} onClick={() => send({ value })}>
            Schatting indienen
          </button>
        </div>
      );

    case "qr_checkpoint":
      return (
        <div className="space-y-2">
          <button className="btn btn-purple w-full" disabled={busy} onClick={() => setScan("checkpoint")}>
            📷 Scan de checkpoint-QR
          </button>
          {testMode ? (
            <button className="btn-demo" disabled={busy} onClick={() => send({ scanned: true })}>
              🧪 Test: checkpoint gescand
            </button>
          ) : null}
          {scan === "checkpoint" ? (
            <QRScanner
              onClose={() => setScan(null)}
              onResult={(data) => {
                setScan(null);
                if (data === `RLYCHK:${assignmentId}`) send({ scanned: true });
                else toast("❌ Dit is niet de juiste checkpoint-QR.");
              }}
            />
          ) : null}
        </div>
      );

    case "qr_search": {
      const signs = (cfg.signs as string[]) ?? ["A", "B", "C"];
      return (
        <div className="space-y-2">
          <button className="btn btn-purple w-full" disabled={busy} onClick={() => setScan("search")}>
            📷 Scan een bordje
          </button>
          {testMode ? (
            <div className="grid grid-cols-3 gap-2">
              {signs.map((s) => (
                <button
                  key={s}
                  disabled={busy || disabledSigns.has(s)}
                  className="btn-demo disabled:opacity-40"
                  onClick={async () => {
                    const r = await send({ sign: s });
                    if (!r.ok) setDisabledSigns((d) => new Set(d).add(s));
                  }}
                >
                  🧪 {s}
                </button>
              ))}
            </div>
          ) : null}
          {scan === "search" ? (
            <QRScanner
              onClose={() => setScan(null)}
              onResult={(data) => {
                setScan(null);
                const m = data.match(/^RLYSIGN:([^:]+):(.+)$/);
                if (m && m[1] === assignmentId) send({ sign: m[2] });
                else toast("❌ Dit bordje hoort niet bij deze opdracht.");
              }}
            />
          ) : null}
        </div>
      );
    }

    case "speed_test":
      return <SpeedTest cfg={cfg} busy={busy} testMode={testMode} send={send} />;

    case "code_breaker":
      return (
        <div className="space-y-2">
          {cfg.riddle ? <p className="rounded-soft bg-white p-2 text-[13px] text-polder-grey">🧩 {String(cfg.riddle)}</p> : null}
          <input
            className="input text-center text-xl font-bold tracking-[8px]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="code"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn btn-purple w-full" disabled={busy} onClick={() => send({ code: text })}>
            Ontgrendel het slot
          </button>
        </div>
      );

    case "compass_point":
      return (
        <button className="btn-demo" disabled={busy} onClick={() => send({ arrived: true })}>
          🧭 Bevestig: op koers aangekomen
        </button>
      );

    case "photo_search":
      return (
        <div className="space-y-2">
          <label className="btn-demo block cursor-pointer text-center">
            📷 Foto maken / kiezen{busy ? " — uploaden…" : ""}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (!f) return;
                toast("📷 Foto vastgelegd — uploaden…");
                sendForm({ photo: true }, f);
              }}
            />
          </label>
          <p className="text-[11px] text-polder-grey">De foto wordt als bewijs geüpload en na afloop door de organisator bekeken.</p>
        </div>
      );

    case "ordering": {
      function move(i: number, dir: -1 | 1) {
        const j = i + dir;
        if (j < 0 || j >= orderList.length) return;
        const copy = [...orderList];
        [copy[i], copy[j]] = [copy[j], copy[i]];
        setOrderList(copy);
      }
      return (
        <div className="space-y-2">
          <p className="text-[13px] text-polder-grey">Zet in de juiste volgorde met de pijltjes:</p>
          <div className="space-y-1.5">
            {orderList.map((it, i) => (
              <div key={it + i} className="flex items-center gap-2 rounded-soft border-2 border-polder-line bg-white p-2">
                <span className="w-5 text-center text-xs font-bold text-polder-grey">{i + 1}</span>
                <span className="flex-1 text-sm font-semibold">{it}</span>
                <button className="btn btn-ghost px-2 py-1 text-xs disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
                <button className="btn btn-ghost px-2 py-1 text-xs disabled:opacity-30" disabled={i === orderList.length - 1} onClick={() => move(i, 1)}>▼</button>
              </div>
            ))}
          </div>
          <button className="btn btn-purple w-full" disabled={busy} onClick={() => send({ order: orderList })}>
            Volgorde indienen
          </button>
        </div>
      );
    }

    case "video_task":
      return (
        <div className="space-y-2">
          <label className="btn-demo block cursor-pointer text-center">
            🎥 Filmpje opnemen{busy ? " — uploaden…" : ""}
            <input
              type="file"
              accept="video/*"
              capture="environment"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f) void sendVideo(f);
                e.target.value = "";
              }}
            />
          </label>
          <label className="btn btn-ghost block cursor-pointer text-center">
            📁 Bestaand filmpje uploaden
            <input
              type="file"
              accept="video/*"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f) void sendVideo(f);
                e.target.value = "";
              }}
            />
          </label>
          <p className="text-[11px] text-polder-grey">Maximaal {Number(cfg.maxSec) > 0 ? Number(cfg.maxSec) : MAX_VIDEO_SEC} seconden. Neem direct op of kies een filmpje uit je galerij. De organisator bekijkt het na afloop.</p>
        </div>
      );

    case "game_master":
      return <GameMasterInput cfg={cfg} busy={busy} send={send} />;

    case "free_game": {
      const max = Number(cfg.max ?? 15);
      const unit = String(cfg.unitLabel ?? "punt");
      return (
        <div className="space-y-2">
          <label className="field-label">Score (0–{max} {unit}s)</label>
          <input
            type="number"
            min={0}
            max={max}
            className="input"
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
          />
          <label className="btn-demo block cursor-pointer text-center">
            {photoFile ? "📷 Bewijsfoto gekozen ✓" : "📷 Bewijsfoto maken (optioneel)"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button className="btn btn-purple w-full" disabled={busy} onClick={() => sendForm({ selfScore: value }, photoFile)}>
            {busy ? "Indienen…" : "Score indienen"}
          </button>
        </div>
      );
    }

    default:
      return <p className="text-sm text-polder-grey">Dit opdrachttype wordt binnenkort ondersteund.</p>;
  }
}

// ── code breaker: input + two-step help ──────────────────────────────────────
function CodeBreakerHelp({
  assignment,
  hintUsed,
  onHint,
  onScored,
  toast,
}: {
  assignment: PublicAssignment;
  hintUsed: boolean;
  onHint: () => void;
  onScored: (score: number, badge?: { name: string; icon: string }) => void;
  toast: (m: string) => void;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function buy() {
    setBusy(true);
    const r = await buyDigit(assignment.id);
    setBusy(false);
    if (r.error) return toast(r.error);
    if (r.revealed) setRevealed(r.revealed);
    onScored(r.score);
  }

  return (
    <div className="mt-2">
      {revealed ? (
        <div className="mb-2 rounded-soft bg-white p-2 text-center text-2xl font-bold tracking-[12px] text-purple">
          {revealed}
        </div>
      ) : null}
      {!hintUsed ? (
        <button className="btn btn-ghost w-full" onClick={onHint} disabled={busy}>
          💡 Hint gebruiken (−{assignment.hint_cost} ptn)
        </button>
      ) : (
        <button className="btn btn-ghost w-full" onClick={buy} disabled={busy}>
          🔢 Koop een cijfer (−{Number((assignment.public_config as { digitCost?: number }).digitCost ?? 10)} ptn)
        </button>
      )}
      {hintUsed ? (
        <p className="mt-1.5 text-xs text-polder-grey">
          Kom je er na de hint nog niet uit? Koop cijfers van de code, één voor één, van links naar rechts.
        </p>
      ) : null}
    </div>
  );
}

// ── finish ────────────────────────────────────────────────────────────────────
function FinishView({
  teamName,
  score,
  hintsUsed,
  badges,
  board,
}: {
  teamName: string;
  score: number;
  hintsUsed: number;
  badges: { name: string; icon: string }[];
  board: LeaderboardRow[];
}) {
  const myPos = board.findIndex((r) => r.me) + 1;
  // mark finished on the server, once
  useEffect(() => {
    void finishRally();
  }, []);

  return (
    <div className="space-y-3.5">
      <div className="card bg-teal-dark text-center text-white">
        <div className="text-[46px]">🏁</div>
        <h3 className="text-[22px] font-bold text-white">Gefinisht!</h3>
        <p className="mt-1 text-sm opacity-85">
          {teamName} · plek {myPos} van {board.length}
        </p>
      </div>
      <div className="card">
        <h3 className="mb-2 font-bold text-teal-dark">Jullie statistieken</h3>
        <div className="grid grid-cols-3 gap-2">
          <Stat b={String(score)} s="punten" />
          <Stat b={String(hintsUsed)} s="hints" />
          <Stat b={String(badges.length)} s="badges" />
        </div>
      </div>
      <div className="card">
        <h3 className="mb-2 font-bold text-teal-dark">🎖️ Badges</h3>
        {badges.length ? (
          <div className="flex flex-wrap justify-center gap-4">
            {badges.map((b) => (
              <div key={b.name} className="text-center">
                <div className="text-[46px]">{b.icon}</div>
                <b className="text-[13px]">{b.name}</b>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-sm text-polder-grey">Nog geen badges — volgende keer beter!</p>
        )}
      </div>
      <div className="card">
        <h3 className="mb-2 font-bold text-teal-dark">🏆 Eindklassement</h3>
        <LeaderboardList board={board} />
      </div>
      <form action={leaveTeam}>
        <button className="btn btn-ghost w-full" type="submit">
          Nieuw team / opnieuw spelen
        </button>
      </form>
    </div>
  );
}

function Stat({ b, s }: { b: string; s: string }) {
  return (
    <div className="rounded-soft bg-teal-light p-2.5 text-center">
      <b className="block text-xl text-teal-dark">{b}</b>
      <span className="text-[11px] font-bold uppercase tracking-wide text-polder-grey">{s}</span>
    </div>
  );
}

function LeaderboardList({ board }: { board: LeaderboardRow[] }) {
  return (
    <div className="mb-2 space-y-2">
      {board.map((r, i) => (
        <div
          key={r.team_id}
          className={`flex items-center gap-2.5 rounded-soft border-2 p-2.5 font-semibold ${
            r.me ? "border-coral bg-coral-light" : "border-transparent bg-white"
          }`}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-light text-[13px] font-bold text-teal-dark">
            {i + 1}
          </span>
          <span className="flex-1">
            {r.me ? "⭐ " : ""}
            {r.name}
          </span>
          <span className="font-bold text-teal-dark">{r.score} ptn</span>
        </div>
      ))}
    </div>
  );
}
