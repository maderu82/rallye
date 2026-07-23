"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PlayState } from "@/lib/play/data";
import type { LeaderboardRow, Leg, Point, PublicAssignment } from "@/lib/types";
import { BLOCK_BY_TYPE, GRADING_LABEL, NAV_BY_MODE } from "@/lib/blocks";
import { answerEnroute, buyDigit, endTestPlay, finishRally, leaveTeam, submitAnswer, submitAnswerWithPhoto, useHint } from "@/lib/play/actions";
import { createClient } from "@/lib/supabase/client";
import QRScanner from "@/components/QRScanner";

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
}: {
  state: PlayState;
  leaderboard: LeaderboardRow[];
  testMode?: boolean;
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
  const [unlocked, setUnlocked] = useState(!point.gps_unlock);
  const done = assignment ? completed.has(assignment.id) : true;

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
          enrouteAnswered={answeredEnroute.has(leg.id)}
          onScored={onScored}
          toast={toast}
          onEnrouteAnswered={() => onEnrouteAnswered(leg.id)}
        />
      ) : null}

      {point.note ? (
        <div className="mb-3.5 rounded-card bg-teal-light p-3 text-sm text-teal-dark">
          📍 <b>{point.name}</b> — {point.note}
        </div>
      ) : null}

      {!unlocked && point.gps_unlock ? (
        <GpsUnlock point={point} testMode={testMode} onUnlock={() => setUnlocked(true)} toast={toast} />
      ) : null}

      {assignment ? (
        <div className={unlocked || !point.gps_unlock ? "" : "pointer-events-none opacity-50 grayscale"}>
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
  enrouteAnswered,
  onScored,
  toast,
  onEnrouteAnswered,
}: {
  leg: Leg;
  target: Point;
  enrouteAnswered: boolean;
  onScored: (score: number) => void;
  toast: (m: string) => void;
  onEnrouteAnswered: () => void;
}) {
  const nav = NAV_BY_MODE[leg.nav_mode];
  return (
    <div className="card mb-3.5 border-l-4 border-teal">
      <h3 className="mb-2 text-base font-bold text-teal-dark">
        {nav.icon} {nav.label.split(" (")[0]}
      </h3>

      {leg.nav_mode === "compass" ? <LiveCompass target={target} /> : null}

      {leg.nav_mode === "routebook" || leg.nav_mode === "turn" ? (
        <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed">
          {(leg.steps ?? "").split("\n").filter(Boolean).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      ) : null}

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

  // rotate the dial so N points to real north; the needle sits at the target's
  // absolute bearing → on screen the needle points the real-world direction.
  const dialRot = heading != null ? -heading : 0;

  return (
    <div className="flex flex-col items-center py-1.5">
      <div className="compass" style={{ transform: `rotate(${dialRot}deg)`, transition: "transform .12s linear" }}>
        <span className="pt" style={{ top: 8, left: "50%", transform: "translateX(-50%)" }}>N</span>
        <span className="pt" style={{ bottom: 8, left: "50%", transform: "translateX(-50%)" }}>Z</span>
        <span className="pt" style={{ left: 10, top: "50%", transform: "translateY(-50%)" }}>W</span>
        <span className="pt" style={{ right: 10, top: "50%", transform: "translateY(-50%)" }}>O</span>
        <div className="needle" style={{ transform: `rotate(${bearing ?? 0}deg)`, transition: "transform .2s ease" }} />
      </div>
      <div className="mt-3 flex gap-6 font-bold text-teal-dark">
        <div className="text-center">
          <b className="block text-[22px] text-coral">{bearing != null ? `${Math.round(bearing)}°` : "—"}</b>koers
        </div>
        <div className="text-center">
          <b className="block text-[22px] text-coral">{distance != null ? (distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${distance} m`) : "—"}</b>afstand
        </div>
      </div>
      {needPerm ? (
        <button className="btn btn-ghost mt-2 text-sm" onClick={enableCompass}>
          🧭 Kompas activeren
        </button>
      ) : (
        <p className="mt-2 text-center text-xs text-polder-grey">
          {err
            ? "Zet gps aan om koers en afstand te zien."
            : heading != null
              ? "Draai tot de rode pijl omhoog wijst en loop die kant op 🧭"
              : pos
                ? "Live berekend vanaf jullie locatie 📍"
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

function GpsUnlock({ point, testMode, onUnlock, toast }: { point: Point; testMode: boolean; onUnlock: () => void; toast: (m: string) => void }) {
  const [checking, setChecking] = useState(false);
  const [dist, setDist] = useState<number | null>(null);
  const THRESHOLD = 120; // metres

  function check() {
    if (!("geolocation" in navigator)) {
      setDist(-1);
      return;
    }
    setChecking(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setChecking(false);
        if (point.lat == null || point.lng == null) {
          onUnlock();
          return;
        }
        const d = haversine({ lat: pos.coords.latitude, lng: pos.coords.longitude }, { lat: point.lat, lng: point.lng });
        setDist(Math.round(d));
        if (d <= THRESHOLD) {
          toast("📍 Locatie bereikt — opdracht ontgrendeld!");
          onUnlock();
        }
      },
      () => {
        setChecking(false);
        setDist(-1);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  return (
    <div className="mb-3">
      <div className="mb-2.5 flex items-center gap-2 rounded-soft bg-coral-light p-2.5 text-[13px] font-bold text-coral">
        🔒 Opdracht vergrendeld — kom eerst op de locatie aan.
      </div>
      <button className="btn btn-primary w-full" onClick={check} disabled={checking}>
        {checking ? "📡 Locatie bepalen…" : "📍 Ik ben op locatie"}
      </button>
      {dist !== null && dist >= 0 ? (
        <p className="mt-2 text-center text-[13px] text-polder-grey">Nog {dist} m te gaan.</p>
      ) : null}
      {dist === -1 ? (
        <p className="mt-2 text-center text-[13px] text-polder-grey">Geen gps beschikbaar.</p>
      ) : null}
      {testMode ? (
        <button className="btn-demo mt-2" onClick={onUnlock}>
          🧪 Test: locatie bereikt
        </button>
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
        <TypeBody type={assignment.type} assignmentId={assignment.id} cfg={cfg} busy={busy} testMode={testMode} send={send} sendForm={sendForm} toast={toast} />
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

      {assignment.type === "photo_search" || assignment.type === "free_game" ? (
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
  toast,
}: {
  type: PublicAssignment["type"];
  assignmentId: string;
  cfg: Record<string, unknown>;
  busy: boolean;
  testMode: boolean;
  send: (s: Record<string, unknown>) => Promise<{ ok: boolean }>;
  sendForm: (s: Record<string, unknown>, file?: File | null) => Promise<{ ok: boolean }>;
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

    case "speed_test": {
      const min = Number(cfg.min ?? 20);
      const max = Number(cfg.max ?? 56);
      return (
        <div>
          <div className="my-1.5 text-center text-3xl font-bold text-teal-dark">{value} km/u</div>
          <input
            type="range"
            min={min}
            max={max}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            className="w-full accent-coral"
          />
          <button className="btn-demo mt-3" disabled={busy} onClick={() => send({ value })}>
            🏁 Simuleer: traject voltooid met dit gemiddelde
          </button>
        </div>
      );
    }

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
