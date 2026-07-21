"use client";

import { useEffect, useMemo, useState } from "react";
import type { PlayState } from "@/lib/play/data";
import type { LeaderboardRow, Leg, Point, PublicAssignment } from "@/lib/types";
import { BLOCK_BY_TYPE, GRADING_LABEL, NAV_BY_MODE } from "@/lib/blocks";
import { buyDigit, finishRally, leaveTeam, submitAnswer, useHint } from "@/lib/play/actions";

// ============================================================================
// Participant play flow. All scoring goes through server actions; this client
// only reflects results. Answer keys are never present here.
// ============================================================================

type Toast = { id: number; msg: string };

export default function PlayClient({
  state,
  leaderboard,
}: {
  state: PlayState;
  leaderboard: LeaderboardRow[];
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

  // Live leaderboard with the player's running score merged in.
  const liveBoard = useMemo(() => {
    return leaderboard
      .map((r) => (r.me ? { ...r, score } : r))
      .sort((a, b) => b.score - a.score);
  }, [leaderboard, score]);

  const title = atFinish
    ? "Finish"
    : `Waypoint ${step + 1} van ${waypoints.length}`;

  return (
    <main className="flex justify-center px-3 py-6">
      <div className="phone">
        <div className="phone-screen">
          <div className="flex justify-between bg-teal-dark px-4 py-1.5 text-[11px] text-[#DFF3EA]">
            <span>09:41</span>
            <span>{state.rally.name}</span>
            <span>📶 🔋</span>
          </div>
          <div className="flex items-center gap-2.5 bg-teal px-3.5 py-2.5 text-white">
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
          </div>

          <div className="flex-1 overflow-y-auto p-4">
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
                onScored={onScored}
                toast={toast}
                onComplete={(aid) => aid && setCompleted((s) => new Set(s).add(aid))}
                onNext={() => setStep((s) => s + 1)}
                isLast={step === waypoints.length - 1}
                finishName={finishPoint?.name ?? "de finish"}
              />
            )}
          </div>

          {lbOpen ? (
            <div
              className="absolute inset-0 z-20 flex items-end bg-teal-dark/45"
              onClick={(e) => {
                if (e.target === e.currentTarget) setLbOpen(false);
              }}
            >
              <div className="max-h-[78%] w-full overflow-y-auto rounded-t-3xl bg-paper p-4">
                <h3 className="mb-3 text-lg font-bold text-teal-dark">🏆 Live klassement</h3>
                <LeaderboardList board={liveBoard} />
                <button className="btn btn-ghost w-full" onClick={() => setLbOpen(false)}>
                  Sluiten
                </button>
              </div>
            </div>
          ) : null}

          <div>
            {toasts.map((t) => (
              <div key={t.id} className="toast">
                {t.msg}
              </div>
            ))}
          </div>
        </div>
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
  onScored: (score: number, badge?: { name: string; icon: string }) => void;
  toast: (m: string) => void;
  onComplete: (assignmentId?: string) => void;
  onNext: () => void;
  isLast: boolean;
  finishName: string;
}) {
  const { point, leg, assignment, stepIndex, total, completed, onScored, toast, onComplete, onNext, isLast } = props;
  const [unlocked, setUnlocked] = useState(!point.gps_unlock);
  const done = assignment ? completed.has(assignment.id) : true;

  return (
    <div>
      <div className="progress">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={i < stepIndex ? "done" : i === stepIndex ? "cur" : ""} />
        ))}
      </div>

      {leg ? <LegNav leg={leg} /> : null}

      {!unlocked && point.gps_unlock ? (
        <GpsUnlock point={point} onUnlock={() => setUnlocked(true)} toast={toast} />
      ) : null}

      {assignment ? (
        <div className={unlocked || !point.gps_unlock ? "" : "pointer-events-none opacity-50 grayscale"}>
          <AssignmentCard
            assignment={assignment}
            done={done}
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

// ── leg navigation (per mode) ────────────────────────────────────────────────
function LegNav({ leg }: { leg: Leg }) {
  const nav = NAV_BY_MODE[leg.nav_mode];
  return (
    <div className="card mb-3.5 border-l-4 border-teal">
      <h3 className="mb-2 text-base font-bold text-teal-dark">
        {nav.icon} {nav.label.split(" (")[0]}
      </h3>

      {leg.nav_mode === "compass" ? (
        <div className="flex flex-col items-center py-1.5">
          <div className="compass">
            <span className="pt" style={{ top: 8, left: "50%", transform: "translateX(-50%)" }}>N</span>
            <span className="pt" style={{ bottom: 8, left: "50%", transform: "translateX(-50%)" }}>Z</span>
            <span className="pt" style={{ left: 10, top: "50%", transform: "translateY(-50%)" }}>W</span>
            <span className="pt" style={{ right: 10, top: "50%", transform: "translateY(-50%)" }}>O</span>
            <div className="needle" style={{ transform: `rotate(${leg.bearing ?? 0}deg)` }} />
          </div>
          <div className="mt-3 flex gap-6 font-bold text-teal-dark">
            <div className="text-center">
              <b className="block text-[22px] text-coral">{leg.bearing ?? "?"}°</b>koers
            </div>
            <div className="text-center">
              <b className="block text-[22px] text-coral">{leg.distance ?? "?"} m</b>afstand
            </div>
          </div>
        </div>
      ) : null}

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
        <div className="mt-2.5 rounded-soft bg-purple-light p-2.5 text-[13px] font-semibold text-purple">
          ❓ Onderwegvraag actief: {leg.enroute_question} ({leg.enroute_points} ptn)
        </div>
      ) : null}
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

function GpsUnlock({ point, onUnlock, toast }: { point: Point; onUnlock: () => void; toast: (m: string) => void }) {
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
      <button className="btn-demo mt-2" onClick={onUnlock}>
        📍 Simuleer: locatie bereikt
      </button>
    </div>
  );
}

// ── assignment card (dispatches per building block) ──────────────────────────
function AssignmentCard({
  assignment,
  done,
  onScored,
  toast,
  onComplete,
}: {
  assignment: PublicAssignment;
  done: boolean;
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
        <TypeBody type={assignment.type} cfg={cfg} busy={busy} send={send} toast={toast} />
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
  cfg,
  busy,
  send,
  toast,
}: {
  type: PublicAssignment["type"];
  cfg: Record<string, unknown>;
  busy: boolean;
  send: (s: Record<string, unknown>) => Promise<{ ok: boolean }>;
  toast: (m: string) => void;
}) {
  const [text, setText] = useState("");
  const [value, setValue] = useState<number>(Number(cfg.target ?? 0));
  const [disabledSigns, setDisabledSigns] = useState<Set<string>>(new Set());

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
        <button className="btn-demo" disabled={busy} onClick={() => send({ scanned: true })}>
          📷 Scan de checkpoint-QR
        </button>
      );

    case "qr_search": {
      const signs = (cfg.signs as string[]) ?? ["A", "B", "C"];
      return (
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
              Scan {s}
            </button>
          ))}
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
            📷 Foto maken / kiezen
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={() => {
                toast("📷 Foto vastgelegd");
                send({ photo: true });
              }}
            />
          </label>
        </div>
      );

    case "ordering": {
      const items = (cfg.items as string[]) ?? [];
      return (
        <div className="space-y-2">
          <p className="text-[13px] text-polder-grey">Zet in de juiste volgorde (typ de nummers, bijv. 3,1,2):</p>
          <ul className="list-disc pl-5 text-sm">
            {items.map((it, i) => (
              <li key={i}>{i + 1}. {it}</li>
            ))}
          </ul>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="bijv. 3,1,2" />
          <button
            className="btn btn-purple w-full"
            disabled={busy}
            onClick={() => send({ order: text.split(",").map((s) => s.trim()) })}
          >
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
          <button className="btn btn-purple w-full" disabled={busy} onClick={() => send({ selfScore: value })}>
            Score indienen
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
