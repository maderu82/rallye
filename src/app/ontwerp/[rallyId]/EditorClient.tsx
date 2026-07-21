"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Assignment, Leg, Point, Rally } from "@/lib/types";
import { BLOCKS, GRADING_LABEL, HINT_LABEL, NAV_MODES, NAV_BY_MODE, BLOCK_BY_TYPE } from "@/lib/blocks";
import {
  addPoint,
  deletePoint,
  deleteRally,
  renameRally,
  reorderPoint,
  togglePublish,
  updateAssignment,
  updateLeg,
  updatePoint,
} from "@/lib/designer/actions";
import { logout } from "@/lib/auth/actions";

type LiveTeam = {
  id: string;
  name: string;
  current_index: number;
  finished: boolean;
  score: number;
  hints: number;
};
type Sel = { kind: "point" | "leg"; id: string } | null;

export default function EditorClient({
  rally,
  points,
  legs,
  assignments,
  liveTeams,
}: {
  rally: Rally;
  points: Point[];
  legs: Leg[];
  assignments: Assignment[];
  liveTeams: LiveTeam[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<"build" | "live">("build");
  const [sel, setSel] = useState<Sel>(null);
  const [addMode, setAddMode] = useState(false);

  function run(fn: () => Promise<unknown>) {
    start(async () => {
      await fn();
      router.refresh();
    });
  }

  const assignmentByPoint = new Map(assignments.map((a) => [a.point_id, a]));

  function labelOf(p: Point): string {
    if (p.kind === "start") return "S";
    if (p.kind === "finish") return "F";
    const wp = points.filter((x) => x.kind === "waypoint");
    return String(wp.findIndex((x) => x.id === p.id) + 1);
  }

  function mapClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!addMode) return;
    const svg = e.currentTarget;
    const r = svg.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 560);
    const y = Math.round(((e.clientY - r.top) / r.height) * 420);
    setAddMode(false);
    run(() => addPoint(rally.id, x, y));
  }

  const selPoint = sel?.kind === "point" ? points.find((p) => p.id === sel.id) : undefined;
  const selLeg = sel?.kind === "leg" ? legs.find((l) => l.id === sel.id) : undefined;

  return (
    <main className="mx-auto max-w-[1280px] px-5 py-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link href="/ontwerp" className="btn btn-ghost">← Overzicht</Link>
        <input
          defaultValue={rally.name}
          onBlur={(e) => e.target.value !== rally.name && run(() => renameRally(rally.id, e.target.value))}
          className="input max-w-[280px] flex-1 text-lg font-bold text-teal-dark"
        />
        <span className="chip chip-teal">Code {rally.join_code}</span>
        <div className="flex gap-1.5 rounded-full bg-teal-light p-1">
          <button
            className={`rounded-full px-4 py-2 text-sm font-bold ${tab === "build" ? "bg-teal text-white" : "text-teal-dark"}`}
            onClick={() => setTab("build")}
          >
            🛠️ Route ontwerpen
          </button>
          <button
            className={`rounded-full px-4 py-2 text-sm font-bold ${tab === "live" ? "bg-teal text-white" : "text-teal-dark"}`}
            onClick={() => setTab("live")}
          >
            📡 Teams volgen
          </button>
        </div>
        <button
          className={`btn ${rally.published ? "btn-ghost" : "btn-coral"}`}
          onClick={() => run(() => togglePublish(rally.id, !rally.published))}
        >
          {rally.published ? "✓ Gepubliceerd" : "Publiceer"}
        </button>
        <form action={logout}>
          <button className="btn btn-ghost" type="submit">🔒 Uitloggen</button>
        </form>
      </div>

      {pending ? <p className="mb-2 text-xs text-polder-grey">Bezig met opslaan…</p> : null}

      {tab === "build" ? (
        <div className="grid items-start gap-4 lg:grid-cols-[290px_1fr_330px]">
          {/* list */}
          <div className="card">
            <h3 className="mb-2.5 text-sm font-bold uppercase tracking-wide text-teal-dark">Punten & trajecten</h3>
            <div className="space-y-1.5">
              {points.map((p, i) => {
                const a = assignmentByPoint.get(p.id);
                const isSF = p.kind !== "waypoint";
                const wpCount = points.filter((x) => x.kind === "waypoint").length;
                const wpIndex = points.filter((x) => x.kind === "waypoint").findIndex((x) => x.id === p.id);
                return (
                  <div key={p.id}>
                    <button
                      onClick={() => setSel({ kind: "point", id: p.id })}
                      className={`flex w-full items-center gap-2.5 rounded-soft border-2 p-2.5 text-left font-semibold ${
                        sel?.kind === "point" && sel.id === p.id ? "border-coral bg-coral-light" : "border-transparent bg-paper hover:border-teal"
                      }`}
                    >
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white"
                        style={{ background: isSF ? "#D85A30" : "#1D9E75" }}
                      >
                        {labelOf(p)}
                      </span>
                      <span className="flex-1">
                        {p.name}
                        <small className="block font-normal text-xs text-polder-grey">
                          {p.has_task && a ? BLOCK_BY_TYPE[a.type].label : p.kind === "start" ? "Aanmelden" : p.kind === "finish" ? "Eindscherm" : "Geen opdracht"}
                          {p.lat != null ? ` · ${p.lat}, ${p.lng}` : ""}
                        </small>
                      </span>
                      {!isSF ? (
                        <span className="ml-auto flex flex-col gap-0.5">
                          <span
                            className={`flex h-4 w-5 items-center justify-center rounded bg-teal-light text-[10px] font-bold text-teal-dark ${wpIndex <= 0 ? "opacity-25" : "hover:bg-teal hover:text-white"}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (wpIndex > 0) run(() => reorderPoint(rally.id, p.id, -1));
                            }}
                          >
                            ▲
                          </span>
                          <span
                            className={`flex h-4 w-5 items-center justify-center rounded bg-teal-light text-[10px] font-bold text-teal-dark ${wpIndex >= wpCount - 1 ? "opacity-25" : "hover:bg-teal hover:text-white"}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (wpIndex < wpCount - 1) run(() => reorderPoint(rally.id, p.id, 1));
                            }}
                          >
                            ▼
                          </span>
                        </span>
                      ) : null}
                    </button>
                    {i < legs.length ? (
                      <button
                        onClick={() => setSel({ kind: "leg", id: legs[i].id })}
                        className={`ml-6 mt-1.5 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-soft border-2 border-dashed p-2 text-left text-[13px] font-semibold ${
                          sel?.kind === "leg" && sel.id === legs[i].id ? "border-coral bg-coral-light text-ink" : "border-polder-line text-polder-grey hover:border-teal"
                        }`}
                      >
                        <span className="text-[15px]">{NAV_BY_MODE[legs[i].nav_mode].icon}</span>
                        <span className="flex-1">
                          Traject {labelOf(p)} → {labelOf(points[i + 1])}
                          <small className="block font-normal text-[11px]">{legSummary(legs[i])}</small>
                        </span>
                        {legs[i].enroute_enabled ? <span className="rounded-xl bg-purple-light px-2 py-0.5 text-[11px] text-purple">❓</span> : null}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          {/* map */}
          <div className="card">
            <h3 className="mb-2.5 text-sm font-bold uppercase tracking-wide text-teal-dark">Kaart — klik een punt of traject</h3>
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              <button className="btn btn-coral text-sm" onClick={() => setAddMode((v) => !v)}>
                {addMode ? "✖ Annuleer plaatsen" : "➕ Nieuw punt met gps-locatie"}
              </button>
              {addMode ? <span className="chip chip-teal">Klik op de kaart om het punt te plaatsen</span> : null}
            </div>
            <svg
              viewBox="0 0 560 420"
              onClick={mapClick}
              className={`w-full rounded-xl ${addMode ? "cursor-crosshair outline outline-2 outline-dashed outline-coral" : ""}`}
              style={{ background: "#DDF0E7" }}
            >
              <path d="M0 300 C120 280 200 330 320 305 C430 285 500 320 560 300 L560 420 L0 420 Z" fill="#BBDFF0" />
              <path d="M300 0 C310 90 280 160 305 250" stroke="#BBDFF0" strokeWidth="26" fill="none" />
              <path d="M40 40 L200 30 L210 140 L60 150 Z" fill="#CDEBDC" />
              <path d="M360 40 L520 55 L505 160 L370 150 Z" fill="#CDEBDC" />
              <path d={routePath(points)} stroke="#1D9E75" strokeWidth="4" strokeDasharray="9 7" fill="none" />
              {legs.map((l, i) => {
                const a = points[i], b = points[i + 1];
                if (!a || !b) return null;
                const mx = ((a.map_x ?? 0) + (b.map_x ?? 0)) / 2;
                const my = ((a.map_y ?? 0) + (b.map_y ?? 0)) / 2;
                const on = sel?.kind === "leg" && sel.id === l.id;
                return (
                  <g key={l.id} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); setSel({ kind: "leg", id: l.id }); }}>
                    <line x1={a.map_x ?? 0} y1={a.map_y ?? 0} x2={b.map_x ?? 0} y2={b.map_y ?? 0} stroke="transparent" strokeWidth={18} />
                    <rect x={mx - 11} y={my - 11} width={22} height={22} rx={6} transform={`rotate(45 ${mx} ${my})`} fill={on ? "#D85A30" : "#fff"} stroke={on ? "#fff" : "#1D9E75"} strokeWidth={2.5} />
                    <text x={mx} y={my + 4} textAnchor="middle" fontSize={11} style={{ pointerEvents: "none" }}>
                      {l.enroute_enabled ? "❓" : NAV_BY_MODE[l.nav_mode].icon}
                    </text>
                  </g>
                );
              })}
              {points.map((p) => {
                const on = sel?.kind === "point" && sel.id === p.id;
                const isSF = p.kind !== "waypoint";
                return (
                  <g key={p.id} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); setSel({ kind: "point", id: p.id }); }}>
                    <circle cx={p.map_x ?? 0} cy={p.map_y ?? 0} r={on ? 16 : 13} fill={on || isSF ? "#D85A30" : "#1D9E75"} stroke="#fff" strokeWidth={3} />
                    <text x={p.map_x ?? 0} y={(p.map_y ?? 0) + 4} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#fff" style={{ pointerEvents: "none" }}>
                      {labelOf(p)}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="mt-3 rounded-soft border-[1.5px] border-dashed border-[#C9A227] bg-[#FFF9E8] p-2.5 text-[13px] text-[#6B5200]">
              🧪 Illustratieve kaart. Punten die je plaatst krijgen automatisch een (demo-)gps-locatie; deelnemers ontgrendelen opdrachten via echte gps-nabijheid.
            </div>
          </div>

          {/* settings */}
          <div className="card">
            <h3 className="mb-2.5 text-sm font-bold uppercase tracking-wide text-teal-dark">Instellingen</h3>
            {selPoint ? (
              <PointSettings
                key={selPoint.id}
                rallyId={rally.id}
                point={selPoint}
                assignment={assignmentByPoint.get(selPoint.id)}
                onDelete={() => { setSel(null); run(() => deletePoint(rally.id, selPoint.id)); }}
                run={run}
              />
            ) : selLeg ? (
              <LegSettings key={selLeg.id} rallyId={rally.id} leg={selLeg} from={labelOf(points[legs.indexOf(selLeg)])} to={labelOf(points[legs.indexOf(selLeg) + 1])} run={run} />
            ) : (
              <p className="text-sm text-polder-grey">Selecteer een punt of een traject in de lijst of op de kaart.</p>
            )}
            <div className="mt-4 border-t border-polder-line pt-3">
              <button className="btn btn-danger w-full text-sm" onClick={() => run(() => deleteRally(rally.id))}>
                🗑️ Verwijder deze rally
              </button>
            </div>
          </div>
        </div>
      ) : (
        <LiveView points={points} teams={liveTeams} labelOf={labelOf} onRefresh={() => router.refresh()} />
      )}
    </main>
  );
}

// ── settings: point ──────────────────────────────────────────────────────────
function PointSettings({
  rallyId,
  point,
  assignment,
  onDelete,
  run,
}: {
  rallyId: string;
  point: Point;
  assignment?: Assignment;
  onDelete: () => void;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const isSF = point.kind !== "waypoint";
  return (
    <div className="space-y-3">
      <span className="inline-block rounded-full bg-purple-light px-2.5 py-1 text-xs font-bold text-purple">📍 Punt {point.name}</span>
      <div>
        <label className="field-label">Naam punt</label>
        <input defaultValue={point.name} className="input" onBlur={(e) => run(() => updatePoint(rallyId, point.id, { name: e.target.value }))} />
      </div>
      <div>
        <label className="field-label">Gps-locatie</label>
        <div className="grid grid-cols-2 gap-2">
          <input defaultValue={point.lat ?? ""} className="input" placeholder="lat" onBlur={(e) => run(() => updatePoint(rallyId, point.id, { lat: e.target.value ? Number(e.target.value) : null }))} />
          <input defaultValue={point.lng ?? ""} className="input" placeholder="lng" onBlur={(e) => run(() => updatePoint(rallyId, point.id, { lng: e.target.value ? Number(e.target.value) : null }))} />
        </div>
      </div>

      {isSF ? (
        <p className="text-[13px] text-polder-grey">Start en finish hebben geen opdracht en kunnen niet worden verwijderd of verplaatst in de volgorde.</p>
      ) : (
        <>
          <label className="flex items-center gap-2.5 text-sm font-semibold">
            <input type="checkbox" defaultChecked={point.has_task} className="scale-125 accent-teal" onChange={(e) => run(() => updatePoint(rallyId, point.id, { has_task: e.target.checked }))} />
            Opdracht aan dit punt
          </label>

          {point.has_task && assignment ? (
            <div className="space-y-3 rounded-soft bg-paper p-3">
              <div>
                <label className="field-label">Soort spel (bouwsteen)</label>
                <select
                  defaultValue={assignment.type}
                  className="input"
                  onChange={(e) => {
                    const def = BLOCK_BY_TYPE[e.target.value as (typeof BLOCKS)[number]["type"]];
                    run(() => updateAssignment(rallyId, point.id, { type: def.type, grading: def.grading }));
                  }}
                >
                  {BLOCKS.map((b) => (
                    <option key={b.type} value={b.type}>
                      {b.label} ({GRADING_LABEL[b.grading]})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Vraag / opdrachttekst</label>
                <input defaultValue={assignment.prompt ?? ""} className="input" onBlur={(e) => run(() => updateAssignment(rallyId, point.id, { prompt: e.target.value }))} />
              </div>
              <div>
                <label className="field-label">Punten</label>
                <input type="number" defaultValue={assignment.points} className="input" onBlur={(e) => run(() => updateAssignment(rallyId, point.id, { points: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="field-label">Hint</label>
                <select defaultValue={assignment.hint_mode} className="input" onChange={(e) => run(() => updateAssignment(rallyId, point.id, { hint_mode: e.target.value as Assignment["hint_mode"] }))}>
                  <option value="off">{HINT_LABEL.off}</option>
                  <option value="free">{HINT_LABEL.free}</option>
                  <option value="cost">{HINT_LABEL.cost} (−{assignment.hint_cost})</option>
                </select>
              </div>
              {assignment.hint_mode !== "off" ? (
                <div>
                  <label className="field-label">Hinttekst</label>
                  <input defaultValue={assignment.hint_text ?? ""} className="input" onBlur={(e) => run(() => updateAssignment(rallyId, point.id, { hint_text: e.target.value }))} />
                </div>
              ) : null}
              <label className="flex items-center gap-2.5 text-sm font-semibold">
                <input type="checkbox" defaultChecked={point.gps_unlock} className="scale-125 accent-teal" onChange={(e) => run(() => updatePoint(rallyId, point.id, { gps_unlock: e.target.checked }))} />
                Ontgrendelen via gps-nabijheid
              </label>
            </div>
          ) : (
            <p className="text-[13px] text-polder-grey">Dit punt is alleen een navigatiepunt — teams komen langs zonder opdracht.</p>
          )}

          <button className="btn btn-danger w-full text-sm" onClick={onDelete}>
            🗑️ Verwijder punt
          </button>
        </>
      )}
    </div>
  );
}

// ── settings: leg ────────────────────────────────────────────────────────────
function LegSettings({
  rallyId,
  leg,
  from,
  to,
  run,
}: {
  rallyId: string;
  leg: Leg;
  from: string;
  to: string;
  run: (fn: () => Promise<unknown>) => void;
}) {
  return (
    <div className="space-y-3">
      <span className="inline-block rounded-full bg-purple-light px-2.5 py-1 text-xs font-bold text-purple">➜ Traject {from} → {to}</span>
      <div>
        <label className="field-label">Navigatiewijze</label>
        <select defaultValue={leg.nav_mode} className="input" onChange={(e) => run(() => updateLeg(rallyId, leg.id, { nav_mode: e.target.value as Leg["nav_mode"] }))}>
          {NAV_MODES.map((n) => (
            <option key={n.mode} value={n.mode}>{n.icon} {n.label}</option>
          ))}
        </select>
      </div>

      {leg.nav_mode === "compass" ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="field-label">Koers (°)</label>
            <input type="number" defaultValue={leg.bearing ?? ""} className="input" onBlur={(e) => run(() => updateLeg(rallyId, leg.id, { bearing: e.target.value ? Number(e.target.value) : null }))} />
          </div>
          <div>
            <label className="field-label">Afstand (m)</label>
            <input type="number" defaultValue={leg.distance ?? ""} className="input" onBlur={(e) => run(() => updateLeg(rallyId, leg.id, { distance: e.target.value ? Number(e.target.value) : null }))} />
          </div>
        </div>
      ) : null}

      {leg.nav_mode === "routebook" || leg.nav_mode === "turn" ? (
        <div>
          <label className="field-label">{leg.nav_mode === "routebook" ? "Routebeschrijving — één stap per regel" : "Bolletje-pijltje — één instructie per regel"}</label>
          <textarea defaultValue={leg.steps ?? ""} className="input min-h-[90px]" onBlur={(e) => run(() => updateLeg(rallyId, leg.id, { steps: e.target.value }))} />
        </div>
      ) : null}

      {leg.nav_mode === "map" ? (
        <div>
          <label className="field-label">Toelichting (optioneel)</label>
          <input defaultValue={leg.note ?? ""} className="input" onBlur={(e) => run(() => updateLeg(rallyId, leg.id, { note: e.target.value }))} />
        </div>
      ) : null}

      <label className="flex items-center gap-2.5 text-sm font-semibold">
        <input type="checkbox" defaultChecked={leg.enroute_enabled} className="scale-125 accent-teal" onChange={(e) => run(() => updateLeg(rallyId, leg.id, { enroute_enabled: e.target.checked }))} />
        Onderwegvraag op dit traject
      </label>
      {leg.enroute_enabled ? (
        <div className="space-y-2 rounded-soft bg-paper p-3">
          <div>
            <label className="field-label">Vraag die onderweg verschijnt</label>
            <input defaultValue={leg.enroute_question ?? ""} className="input" onBlur={(e) => run(() => updateLeg(rallyId, leg.id, { enroute_question: e.target.value }))} />
          </div>
          <div>
            <label className="field-label">Punten</label>
            <input type="number" defaultValue={leg.enroute_points} className="input" onBlur={(e) => run(() => updateLeg(rallyId, leg.id, { enroute_points: Number(e.target.value) }))} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── live view (teams volgen) ─────────────────────────────────────────────────
const TEAM_COLORS = ["#534AB7", "#D85A30", "#0E7490", "#7A5D00"];

function LiveView({
  points,
  teams,
  labelOf,
  onRefresh,
}: {
  points: Point[];
  teams: LiveTeam[];
  labelOf: (p: Point) => string;
  onRefresh: () => void;
}) {
  const maxIndex = Math.max(1, points.length - 1);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[1fr_360px]">
      <div className="card">
        <h3 className="mb-2.5 text-sm font-bold uppercase tracking-wide text-teal-dark">Live kaart — posities van de teams</h3>
        <svg viewBox="0 0 560 420" className="w-full rounded-xl" style={{ background: "#DDF0E7" }}>
          <path d="M0 300 C120 280 200 330 320 305 C430 285 500 320 560 300 L560 420 L0 420 Z" fill="#BBDFF0" />
          <path d="M300 0 C310 90 280 160 305 250" stroke="#BBDFF0" strokeWidth="26" fill="none" />
          <path d={routePath(points)} stroke="#1D9E75" strokeWidth="4" strokeDasharray="9 7" fill="none" />
          {points.map((p) => (
            <g key={p.id}>
              <circle cx={p.map_x ?? 0} cy={p.map_y ?? 0} r={10} fill={p.kind !== "waypoint" ? "#D85A30" : "#1D9E75"} opacity={0.55} />
              <text x={p.map_x ?? 0} y={(p.map_y ?? 0) + 4} textAnchor="middle" fontSize={10} fontWeight="bold" fill="#fff">{labelOf(p)}</text>
            </g>
          ))}
          {teams.map((t, i) => {
            const pos = pathPos(points, Math.min(1, t.current_index / maxIndex));
            return (
              <g key={t.id}>
                <circle cx={pos.x} cy={pos.y} r={9} fill={TEAM_COLORS[i % 4]} stroke="#fff" strokeWidth={2.5} />
                <text x={pos.x} y={pos.y - 13} textAnchor="middle" fontSize={10} fontWeight="bold" fill="#123B2E">{t.name}</text>
              </g>
            );
          })}
        </svg>
        <div className="mt-3 flex items-center justify-between">
          <div className="rounded-soft border-[1.5px] border-dashed border-[#C9A227] bg-[#FFF9E8] p-2.5 text-[13px] text-[#6B5200]">
            👀 Alleen meekijken: foto&apos;s en scores controleer je ná de rally.
          </div>
          <button className="btn btn-ghost text-sm" onClick={onRefresh}>🔄 Ververs</button>
        </div>
      </div>
      <div className="card">
        <h3 className="mb-2.5 text-sm font-bold uppercase tracking-wide text-teal-dark">Voortgang per team</h3>
        {teams.length ? (
          <div className="space-y-2">
            {teams.map((t, i) => (
              <div key={t.id} className={`rounded-soft border-l-4 bg-white p-3 ${t.finished ? "border-coral" : "border-teal"}`}>
                <div className="flex items-center gap-2 font-bold">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ background: TEAM_COLORS[i % 4] }} />
                  {t.name}
                  <span className="ml-auto text-teal-dark">{t.score} ptn</span>
                </div>
                <small className="mt-1 block text-xs text-polder-grey">
                  {t.finished ? "🏁 Gefinisht" : `Onderweg · punt ${t.current_index}`} · {t.hints} hint{t.hints === 1 ? "" : "s"}
                </small>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-polder-line">
                  <i className="block h-full rounded" style={{ width: `${Math.round(Math.min(1, t.current_index / maxIndex) * 100)}%`, background: t.finished ? "#D85A30" : "#1D9E75" }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-polder-grey">Nog geen teams. Zodra teams meedoen, verschijnen ze hier.</p>
        )}
      </div>
    </div>
  );
}

// ── geometry helpers ─────────────────────────────────────────────────────────
function routePath(points: Point[]): string {
  return points.map((p, i) => `${i ? "L" : "M"}${p.map_x ?? 0} ${p.map_y ?? 0}`).join(" ");
}

function pathPos(points: Point[], t: number): { x: number; y: number } {
  const seg: { ax: number; ay: number; bx: number; by: number; len: number }[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const ax = points[i].map_x ?? 0, ay = points[i].map_y ?? 0;
    const bx = points[i + 1].map_x ?? 0, by = points[i + 1].map_y ?? 0;
    const len = Math.hypot(bx - ax, by - ay) || 0.001;
    seg.push({ ax, ay, bx, by, len });
    total += len;
  }
  let d = Math.min(1, Math.max(0, t)) * total;
  for (const s of seg) {
    if (d <= s.len) {
      const f = d / s.len;
      return { x: s.ax + (s.bx - s.ax) * f, y: s.ay + (s.by - s.ay) * f };
    }
    d -= s.len;
  }
  const last = points[points.length - 1];
  return { x: last?.map_x ?? 0, y: last?.map_y ?? 0 };
}

function legSummary(l: Leg): string {
  if (l.nav_mode === "compass") return l.bearing || l.distance ? `koers ${l.bearing ?? "?"}° · ${l.distance ?? "?"} m` : "koers en afstand nog invullen";
  if (l.nav_mode === "map") return l.note || "teams volgen de kaartlijn";
  const first = (l.steps ?? "").split("\n").filter(Boolean);
  return first.length ? `${first.length} instructie${first.length === 1 ? "" : "s"} — "${first[0]}"` : "instructies nog invullen";
}
