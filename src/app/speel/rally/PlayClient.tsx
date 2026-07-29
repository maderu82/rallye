"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PlayState } from "@/lib/play/data";
import type { LeaderboardRow, Leg, Point, PublicAssignment } from "@/lib/types";
import { BLOCK_BY_TYPE, GRADING_LABEL, NAV_BY_MODE, ROADBOOK_BY_ID } from "@/lib/blocks";
import { answerEnroute, buyDigit, buyNextStep, createMediaUploadUrl, endTestPlay, finishRally, leaveTeam, submitAnswer, submitAnswerWithPhoto, submitMedia, useHint } from "@/lib/play/actions";
import { NEXT_STEP_COST } from "@/lib/play/constants";
import { createClient } from "@/lib/supabase/client";
import QRScanner from "@/components/QRScanner";

// Max length for a video-opdracht: keeps uploads small (fits a default bucket).
const MAX_VIDEO_SEC = 10;

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
    // test mode: the organizer can jump straight to a chosen waypoint
    if (testMode && startStep != null) return Math.max(0, Math.min(startStep, waypoints.length));
    // resume at the first not-yet-completed waypoint
    const idx = waypoints.findIndex((w) => {
      const a = assignmentByPoint.get(w.id);
      return !a || !initialCompleted.has(a.id);
    });
    return idx === -1 ? waypoints.length : idx;
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

  const atFinish = step >= waypoints.length;

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
    : `Waypoint ${step + 1} van ${waypoints.length}`;

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-[520px] flex-col">
      {testMode ? (
        <div className="flex items-center justify-center gap-3 bg-[#FFF4D6] px-4 py-1.5 text-center text-xs font-bold text-[#7A5D00]">
          <span>🧪 Testmodus — hulpknoppen zijn zichtbaar; deelnemers zien deze niet.</span>
          <form action={endTestPlay}>
            <button type="submit" className="rounded-full bg-[#7A5D00] px-2.5 py-0.5 text-white">✖ Einde test</button>
          </form>
        </div>
      ) : null}
      <header className="sticky top-0 z-30 flex items-center gap-2.5 bg-teal px-4 py-3 text-white shadow-soft">
        <a href="/" className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white/20 text-base" title="Startscherm">
          ⌂
        </a>
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
      </header>

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
            key={waypoints[step].id}
            point={waypoints[step]}
            leg={legByPosition.get(waypoints[step].position - 1)}
            assignment={assignmentByPoint.get(waypoints[step].id)}
            stepIndex={step}
            total={waypoints.length}
            completed={completed}
            testMode={testMode}
            onScored={onScored}
            toast={toast}
            onComplete={(aid) => aid && setCompleted((s) => new Set(s).add(aid))}
            onNext={() => setStep((s) => s + 1)}
            isLast={step === waypoints.length - 1}
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
  finishName: string;
  answeredEnroute: Set<string>;
  onEnrouteAnswered: (legId: string) => void;
}) {
  const { point, leg, assignment, stepIndex, total, completed, testMode, onScored, toast, onComplete, onNext, isLast, answeredEnroute, onEnrouteAnswered } = props;
  // A speed test must be started at the beginning of the leg, so it isn't
  // arrival-gated like the other assignments.
  const gated = point.gps_unlock && assignment?.type !== "speed_test";
  const [unlocked, setUnlocked] = useState(!gated);
  const done = assignment ? completed.has(assignment.id) : true;
  // Puzzle navigation modes hide the destination: the point name + note would
  // otherwise reveal where to go, so keep them hidden until the team arrives.
  const hideDest = leg != null && ["turn", "routebook", "cryptic", "photo_nav"].includes(leg.nav_mode);

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

      {point.note && (unlocked || !hideDest) ? (
        <div className="mb-3.5 rounded-card bg-teal-light p-3 text-sm text-teal-dark">
          📍 <b>{point.name}</b> — {point.note}
        </div>
      ) : null}

      {!unlocked && gated ? (
        <GpsUnlock
          point={point}
          testMode={testMode}
          hideDistance={hideDest}
          onUnlock={() => setUnlocked(true)}
          toast={toast}
        />
      ) : null}

      {assignment && !unlocked && gated && hideDest ? (
        // Puzzle navigation: don't even preview the task — it can reveal the spot.
        <div className="card border-l-4 border-polder-line text-center text-sm text-polder-grey">
          🔒 De opdracht verschijnt zodra je op de bestemming bent.
        </div>
      ) : assignment ? (
        <div className={unlocked || !gated ? "" : "pointer-events-none opacity-50 grayscale"}>
          <AssignmentCard
            assignment={assignment}
            done={done}
            testMode={testMode}
            onScored={onScored}
            toast={toast}
            onComplete={() => onComplete(assignment.id)}
          />
        </div>
      ) : (
        <div className="card border-l-4 border-teal">
          <p className="text-sm text-polder-grey">Dit is een navigatiepunt — er is hier geen opdracht. Ga door naar het volgende punt.</p>
        </div>
      )}

      {done ? (
        <button className="btn btn-coral mt-1.5 w-full" onClick={onNext}>
          {isLast ? "Naar de finish →" : "Volgende waypoint →"}
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

      {["turn", "routebook", "cryptic"].includes(leg.nav_mode) && (leg.turn_steps ?? []).length > 0 ? (
        <p className="mb-2 text-[11px] text-polder-grey">Tik een stap aan om &apos;m af te vinken zodra je &apos;m gepasseerd bent.</p>
      ) : null}

      {leg.nav_mode === "compass" ? <LiveCompass target={target} /> : null}

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
                  <span className="text-3xl leading-none">{d.icon}</span>
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

      {/* Cryptische route: only the riddle text — no arrow, no distance */}
      {leg.nav_mode === "cryptic" ? (
        <ol className="space-y-2">
          {(leg.turn_steps ?? []).map((s, i) => (
            <li key={i} onClick={() => toggle(i)} className={`flex cursor-pointer items-start gap-3 rounded-soft border-2 border-polder-line bg-white p-2.5 ${checked.has(i) ? "opacity-60" : ""}`}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple text-xs font-bold text-white">{i + 1}</span>
              <div className={`flex-1 font-semibold text-ink ${checked.has(i) ? "line-through" : ""}`}>{s.note || "…"}</div>
              {checkDot(i)}
            </li>
          ))}
          <li className="flex items-center gap-2 rounded-soft bg-teal-light p-2 text-[13px] text-teal-dark">
            🕵️ Los de aanwijzingen onderweg op — de opdracht opent zodra je op de bestemming bent.
          </li>
        </ol>
      ) : null}

      {/* Foto-navigatie: one photo at a time; geofence-confirm arrival to advance */}
      {leg.nav_mode === "photo_nav" ? <PhotoNavSteps leg={leg} testMode={testMode} onScored={onScored} toast={toast} /> : null}

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
      <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="code van de spelleider" autoCapitalize="characters" />
      <label className="field-label">Punten{max ? ` (0–${max})` : ""}</label>
      <input type="number" min={0} max={max || undefined} className="input" value={pts} onChange={(e) => setPts(Number(e.target.value))} />
      <button className="btn btn-purple w-full" disabled={busy || !code.trim()} onClick={() => send({ code: code.trim(), points: pts })}>
        {busy ? "Bezig…" : "Punten toekennen"}
      </button>
    </div>
  );
}

// ── foto-navigatie: one photo at a time; confirm arrival within 100 m ────────
const PHOTO_GEOFENCE_M = 100;

function PhotoNavSteps({
  leg,
  testMode,
  onScored,
  toast,
}: {
  leg: Leg;
  testMode: boolean;
  onScored: (score: number) => void;
  toast: (m: string) => void;
}) {
  const photos = leg.turn_steps ?? [];
  const pts = leg.turn_points ?? [];
  const radius = leg.photo_radius != null && leg.photo_radius > 0 ? leg.photo_radius : PHOTO_GEOFENCE_M;
  const cost = leg.photo_buy_cost != null && leg.photo_buy_cost > 0 ? leg.photo_buy_cost : NEXT_STEP_COST;
  const [idx, setIdx] = useState(0);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);

  // Restore progress so a reload doesn't send the team back to photo 1.
  useEffect(() => {
    const v = Number(localStorage.getItem(`photonav:${leg.id}`) || 0);
    if (v > 0) setIdx(v);
  }, [leg.id]);
  const save = (n: number) => {
    setIdx(n);
    try {
      localStorage.setItem(`photonav:${leg.id}`, String(n));
    } catch {}
  };

  if (photos.length === 0) {
    return <p className="text-sm text-polder-grey">Nog geen foto&apos;s ingesteld voor dit traject.</p>;
  }

  if (idx >= photos.length) {
    return (
      <div className="rounded-soft bg-teal-light p-3 text-center text-sm text-teal-dark">
        📷 Alle foto&apos;s gevonden! Ga nu naar de eindbestemming — de opdracht opent zodra je er bent.
      </div>
    );
  }

  const cur = photos[idx];
  const loc = pts[idx];

  function confirmHere() {
    if (testMode) {
      toast("🧪 Test: volgende foto vrijgegeven.");
      save(idx + 1);
      return;
    }
    if (!loc || loc.lat == null || loc.lng == null) {
      // no coordinates configured for this photo → can't geofence, just advance
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
          toast("📍 Goed gevonden — volgende foto!");
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
    toast(`🛒 Volgende foto vrijgekocht (−${cost}).`);
    save(idx + 1);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[13px] font-bold text-teal-dark">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal text-xs text-white">{idx + 1}</span>
        Foto {idx + 1} van {photos.length} — zoek deze plek
      </div>
      {cur.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cur.photo} alt={`Herkenningspunt ${idx + 1}`} className="w-full rounded-soft object-cover" />
      ) : (
        <div className="rounded-soft bg-paper p-4 text-center text-xs text-polder-grey">Geen foto ingesteld</div>
      )}
      {cur.note ? <p className="text-[13px] text-polder-grey">{cur.note}</p> : null}
      <button className="btn-demo w-full" disabled={checking} onClick={confirmHere}>
        {checking ? "📡 Locatie controleren…" : "📍 We zijn er!"}
      </button>
      <button className="btn btn-ghost w-full text-sm" disabled={busy} onClick={buyNext}>
        {busy ? "Bezig…" : `🛒 Volgende foto afkopen (−${cost} ptn)`}
      </button>
      <p className="text-[11px] text-polder-grey">Je moet binnen ±{radius} m van de plek staan. Geen idee? Koop de volgende foto af — kan alleen als je genoeg punten hebt.</p>
    </div>
  );
}

// ── live compass: bearing + distance from the team's live position, needle
//    that follows the phone's heading (turn until the arrow points up) ─────────
type OrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };
type DOEWithPerm = { requestPermission?: () => Promise<"granted" | "denied"> };

function LiveCompass({ target }: { target: Point }) {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [err, setErr] = useState(false);
  const [heading, setHeading] = useState<number | null>(null);
  const [needPerm, setNeedPerm] = useState(false);
  const offRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setErr(true);
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setErr(true),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  function attachOrientation() {
    const handler = (e: Event) => {
      const oe = e as OrientationEvent;
      let h: number | null = null;
      if (typeof oe.webkitCompassHeading === "number") h = oe.webkitCompassHeading;
      else if (typeof oe.alpha === "number") h = (360 - oe.alpha) % 360;
      if (h != null && !Number.isNaN(h)) setHeading(h);
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
      const res = await DOE.requestPermission?.();
      if (res === "granted") {
        setNeedPerm(false);
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

  // Just a single arrow: when we know the phone heading, rotate it relative to
  // that so the player turns until the arrow points up; otherwise point at the
  // absolute bearing. No compass ring / degrees — that confused players.
  const arrowRot = bearing != null ? (heading != null ? (bearing - heading + 360) % 360 : bearing) : 0;
  const pointingUp = heading != null && bearing != null && Math.abs(((arrowRot + 180) % 360) - 180) < 12;

  return (
    <div className="flex flex-col items-center py-1.5">
      <div className={`flex h-40 w-40 items-center justify-center rounded-full ${pointingUp ? "bg-teal-light" : "bg-paper"}`}>
        <svg
          viewBox="0 0 100 100"
          className="h-28 w-28"
          style={{ transform: `rotate(${arrowRot}deg)`, transition: "transform .15s ease" }}
        >
          <path d="M50 6 L74 62 L50 50 L26 62 Z" fill={pointingUp ? "#1D9E75" : "#D85A30"} />
        </svg>
      </div>
      <div className="mt-3 text-center">
        <b className="block text-[26px] text-coral">
          {distance != null ? (distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${distance} m`) : "—"}
        </b>
        <span className="text-sm text-polder-grey">tot het punt</span>
      </div>
      {needPerm ? (
        <button className="btn btn-ghost mt-2 text-sm" onClick={enableCompass}>
          🧭 Richtingspijl activeren
        </button>
      ) : (
        <p className="mt-2 text-center text-xs text-polder-grey">
          {err
            ? "Zet gps aan om de richting en afstand te zien."
            : heading != null
              ? pointingUp
                ? "Goed zo — loop rechtdoor deze kant op! 🚶"
                : "Draai tot de pijl recht omhoog wijst en loop die kant op."
              : pos
                ? "De pijl wijst de richting naar het punt 📍"
                : "📡 Locatie bepalen…"}
        </p>
      )}
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

  return (
    <div className="mb-3">
      <div className="mb-2.5 flex items-center gap-2 rounded-soft bg-coral-light p-2.5 text-[13px] font-bold text-coral">
        🔒 Opdracht vergrendeld — de opdracht opent automatisch zodra je aankomt.
      </div>
      {hideDistance ? (
        <div className="rounded-soft bg-teal-light p-3 text-center">
          <div className="text-2xl">🧭📖</div>
          <p className="text-[13px] text-polder-grey">
            {err
              ? "📡 Geen gps. Zet locatie aan (of gebruik testmodus)."
              : dist != null
              ? "Volg het roadbook — de opdracht opent zodra je op de bestemming bent."
              : "📡 Locatie bepalen…"}
          </p>
        </div>
      ) : dist != null ? (
        <div className="rounded-soft bg-teal-light p-3 text-center">
          <div className="text-3xl font-bold text-teal-dark">
            {dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${dist} m`}
          </div>
          <p className="text-[13px] text-polder-grey">tot het volgende punt — blijf navigeren 🧭</p>
        </div>
      ) : err ? (
        <p className="text-center text-[13px] text-polder-grey">📡 Geen gps. Zet locatie aan (of gebruik testmodus).</p>
      ) : (
        <p className="text-center text-[13px] text-polder-grey">📡 Locatie bepalen…</p>
      )}
      {testMode ? (
        <button className="btn-demo mt-2" onClick={onUnlock}>
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
  const [phase, setPhase] = useState<"idle" | "measuring">("idle");
  const [distM, setDistM] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const watchRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const lastRef = useRef<{ lat: number; lng: number } | null>(null);
  const distRef = useRef(0);
  const [testVal, setTestVal] = useState<number>(target);

  useEffect(() => () => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
  }, []);

  const avg = elapsed > 0 ? (distM / 1000) / (elapsed / 3600) : 0;

  function start() {
    if (!("geolocation" in navigator)) return;
    setPhase("measuring");
    startRef.current = Date.now();
    distRef.current = 0;
    lastRef.current = null;
    setDistM(0);
    setElapsed(0);
    const tick = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 1000);
    watchRef.current = navigator.geolocation.watchPosition(
      (p) => {
        const cur = { lat: p.coords.latitude, lng: p.coords.longitude };
        if (lastRef.current) distRef.current += haversine(lastRef.current, cur);
        lastRef.current = cur;
        setDistM(Math.round(distRef.current));
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
    // store interval id on the window-less closure via watch cleanup
    intervalRef.current = tick;
  }
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function finish() {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    send({ value: Math.round(avg) });
  }

  return (
    <div className="space-y-2">
      <p className="text-[13px] text-polder-grey">
        Doel: gemiddeld <b className="text-coral">{target} km/u</b>. Druk op start aan het begin van het traject; de gps meet je gemiddelde tot het eindpunt.
      </p>
      {phase === "idle" ? (
        <button className="btn btn-primary w-full" disabled={busy} onClick={start}>▶️ Start meten</button>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-soft bg-teal-light p-2"><b className="block text-lg text-teal-dark">{(distM / 1000).toFixed(2)}</b><span className="text-[11px] text-polder-grey">km</span></div>
            <div className="rounded-soft bg-teal-light p-2"><b className="block text-lg text-teal-dark">{Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, "0")}</b><span className="text-[11px] text-polder-grey">tijd</span></div>
            <div className="rounded-soft bg-teal-light p-2"><b className="block text-lg text-coral">{Math.round(avg)}</b><span className="text-[11px] text-polder-grey">km/u nu</span></div>
          </div>
          <button className="btn btn-coral w-full" disabled={busy} onClick={finish}>🏁 Eindpunt bereikt — dien in</button>
        </div>
      )}
      {testMode ? (
        <div className="rounded-soft border border-dashed border-[#C9A227] p-2">
          <p className="mb-1 text-[11px] font-bold text-[#7A5D00]">🧪 Test: kies een gemiddelde</p>
          <input type="range" min={Number(cfg.min ?? 20)} max={Number(cfg.max ?? 56)} value={testVal} onChange={(e) => setTestVal(Number(e.target.value))} className="w-full accent-coral" />
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
