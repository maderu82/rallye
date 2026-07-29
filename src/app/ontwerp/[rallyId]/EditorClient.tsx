"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { Assignment, Leg, Point, Rally } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import type { MapPoint, MapTeam } from "@/components/RallyMap";
import AssignmentConfig from "./AssignmentConfig";

// Real map is client-only (Leaflet needs window).
const RallyMap = dynamic(() => import("@/components/RallyMap"), {
  ssr: false,
  loading: () => <div className="flex h-[420px] items-center justify-center rounded-xl bg-teal-light text-sm text-teal-dark">Kaart laden…</div>,
});
const RoadbookMap = dynamic(() => import("@/components/RoadbookMap"), {
  ssr: false,
  loading: () => <div className="flex h-[340px] items-center justify-center rounded-xl bg-teal-light text-sm text-teal-dark">Kaart laden…</div>,
});
import { BLOCKS, GRADING_LABEL, HINT_LABEL, NAV_MODES, NAV_BY_MODE, BLOCK_BY_TYPE, ROADBOOK_DIRS } from "@/lib/blocks";
import type { RoadbookStep } from "@/lib/types";
import { deriveRoadbook, fetchRoadRoute } from "@/lib/geo";
import {
  addPoint,
  deletePoint,
  deleteRally,
  importGpx,
  movePointTo,
  renameRally,
  reorderPoint,
  startTestPlay,
  togglePublish,
  updateAssignment,
  updateLeg,
  updatePoint,
} from "@/lib/designer/actions";
import { logout } from "@/lib/auth/actions";

// Parse a GPX file into ordered {name,lat,lng} points (waypoints/route/track).
function parseGpx(xml: string): { name: string; lat: number; lng: number }[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const pick = (tag: string) => Array.from(doc.getElementsByTagName(tag));
  let nodes = pick("wpt");
  if (!nodes.length) nodes = pick("rtept");
  let usedTrack = false;
  if (!nodes.length) {
    nodes = pick("trkpt");
    usedTrack = true;
  }
  let list = nodes
    .map((n) => ({
      name: n.getElementsByTagName("name")[0]?.textContent?.trim() || "",
      lat: Number(n.getAttribute("lat")),
      lng: Number(n.getAttribute("lon")),
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  // A raw track can have thousands of points — downsample to a usable route.
  if (usedTrack && list.length > 30) {
    const step = Math.ceil(list.length / 30);
    const sampled = list.filter((_, i) => i % step === 0);
    const last = list[list.length - 1];
    if (sampled[sampled.length - 1] !== last) sampled.push(last);
    list = sampled;
  }
  return list;
}

type LiveTeam = {
  id: string;
  name: string;
  current_index: number;
  finished: boolean;
  score: number;
  hints: number;
  created_at: string;
};
type ActivityItem = { label: string; answer: string; points: number; photoUrl: string | null; when: string };
type Sel = { kind: "point" | "leg"; id: string } | null;

export default function EditorClient({
  rally,
  points,
  legs,
  assignments,
  liveTeams,
  teamActivity,
}: {
  rally: Rally;
  points: Point[];
  legs: Leg[];
  assignments: Assignment[];
  liveTeams: LiveTeam[];
  teamActivity: Record<string, ActivityItem[]>;
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

  function handleAddPoint(lat: number, lng: number) {
    setAddMode(false);
    run(() => addPoint(rally.id, lat, lng));
  }

  async function handleGpx(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const coords = parseGpx(await file.text());
    if (!coords.length) {
      alert("Geen punten gevonden in dit GPX-bestand.");
      return;
    }
    if (!confirm(`${coords.length} punten importeren uit "${file.name}"? Dit vervangt de huidige route.`)) return;
    run(() => importGpx(rally.id, coords));
  }

  const mapPoints: MapPoint[] = points.map((p) => ({
    id: p.id,
    lat: p.lat,
    lng: p.lng,
    label: labelOf(p),
    kind: p.kind,
  }));

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
        <form action={startTestPlay.bind(null, rally.id)}>
          <button className="btn btn-purple" type="submit" title="Speel de rally zelf om te testen (met hulpknoppen)">▶️ Test als speler</button>
        </form>
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

      <p className="mb-3 text-xs text-polder-grey">
        Deel de teamcode <b className="text-teal-dark">{rally.join_code}</b> met je teams (of laat ze de QR scannen). Publiceer de rally zodat teams kunnen meedoen.
      </p>

      {pending ? <p className="mb-2 text-xs text-polder-grey">Bezig met opslaan…</p> : null}

      {tab === "build" ? (
        <div className="grid items-start gap-4 lg:grid-cols-[290px_1fr_330px]">
          {/* list */}
          <div className="card">
            <h3 className="mb-2.5 text-sm font-bold uppercase tracking-wide text-teal-dark">Punten & trajecten</h3>
            {points.length === 0 ? (
              <p className="rounded-soft bg-teal-light p-3 text-[13px] text-teal-dark">
                Nog geen punten. Klik hiernaast op <b>➕ Nieuw punt op de kaart</b> en plaats je <b>startpunt</b>. Het eerste punt is automatisch de start, het laatste de finish.
              </p>
            ) : null}
            <div className="space-y-1.5">
              {points.map((p, i) => {
                const a = assignmentByPoint.get(p.id);
                const isSF = p.kind !== "waypoint";
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
                      <span className="ml-auto flex flex-col gap-0.5">
                        <span
                          className={`flex h-4 w-5 items-center justify-center rounded bg-teal-light text-[10px] font-bold text-teal-dark ${i <= 0 ? "opacity-25" : "hover:bg-teal hover:text-white"}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (i > 0) run(() => reorderPoint(rally.id, p.id, -1));
                          }}
                        >
                          ▲
                        </span>
                        <span
                          className={`flex h-4 w-5 items-center justify-center rounded bg-teal-light text-[10px] font-bold text-teal-dark ${i >= points.length - 1 ? "opacity-25" : "hover:bg-teal hover:text-white"}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (i < points.length - 1) run(() => reorderPoint(rally.id, p.id, 1));
                          }}
                        >
                          ▼
                        </span>
                      </span>
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
            <h3 className="mb-2.5 text-sm font-bold uppercase tracking-wide text-teal-dark">Kaart — klik een punt aan of plaats een nieuw punt</h3>
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              <button className="btn btn-coral text-sm" onClick={() => setAddMode((v) => !v)}>
                {addMode ? "✖ Annuleer plaatsen" : "➕ Nieuw punt op de kaart"}
              </button>
              <label className="btn btn-ghost cursor-pointer text-sm" title="Importeer een route uit een GPX-bestand (bijv. uit MRA/komoot)">
                ⬆️ Importeer GPX
                <input type="file" accept=".gpx,application/gpx+xml,text/xml" className="hidden" onChange={handleGpx} />
              </label>
              {addMode ? <span className="chip chip-teal">Klik op de kaart om het punt te plaatsen (gps wordt automatisch ingevuld)</span> : null}
            </div>
            <RallyMap
              points={mapPoints}
              selectedId={sel?.kind === "point" ? sel.id : null}
              editable
              addMode={addMode}
              onAddPoint={handleAddPoint}
              onSelectPoint={(id) => setSel({ kind: "point", id })}
              onMovePoint={(id, lat, lng) => run(() => updatePoint(rally.id, id, { lat, lng }))}
            />
            <div className="mt-3 rounded-soft bg-teal-light p-2.5 text-[13px] text-teal-dark">
              🗺️ Echte kaart (OpenStreetMap). Sleep een punt om het te verplaatsen; de gps-locatie wordt automatisch bijgewerkt. Selecteer een traject in de lijst links.
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
                orderIndex={points.findIndex((p) => p.id === selPoint.id)}
                total={points.length}
                assignment={assignmentByPoint.get(selPoint.id)}
                onDelete={() => { if (confirm(`Punt "${selPoint.name}" verwijderen?`)) { setSel(null); run(() => deletePoint(rally.id, selPoint.id)); } }}
                run={run}
              />
            ) : selLeg ? (
              <LegSettings
                key={selLeg.id}
                rallyId={rally.id}
                leg={selLeg}
                from={labelOf(points[legs.indexOf(selLeg)])}
                to={labelOf(points[legs.indexOf(selLeg) + 1])}
                fromPoint={points[legs.indexOf(selLeg)]}
                toPoint={points[legs.indexOf(selLeg) + 1]}
                run={run}
              />
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
        <LiveView rallyId={rally.id} points={points} teams={liveTeams} activity={teamActivity} labelOf={labelOf} onRefresh={() => router.refresh()} />
      )}
    </main>
  );
}

// ── settings: point ──────────────────────────────────────────────────────────
function PointSettings({
  rallyId,
  point,
  orderIndex,
  total,
  assignment,
  onDelete,
  run,
}: {
  rallyId: string;
  point: Point;
  orderIndex: number;
  total: number;
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
        <label className="field-label">Volgorde (1 = start, {total} = finish)</label>
        <input
          key={orderIndex}
          type="number"
          min={1}
          max={total}
          defaultValue={orderIndex + 1}
          className="input"
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (v >= 1 && v <= total && v - 1 !== orderIndex) run(() => movePointTo(rallyId, point.id, v - 1));
          }}
        />
      </div>
      <div>
        <label className="field-label">Gps-locatie</label>
        <div className="grid grid-cols-2 gap-2">
          <input defaultValue={point.lat ?? ""} className="input" placeholder="lat" onBlur={(e) => run(() => updatePoint(rallyId, point.id, { lat: e.target.value ? Number(e.target.value) : null }))} />
          <input defaultValue={point.lng ?? ""} className="input" placeholder="lng" onBlur={(e) => run(() => updatePoint(rallyId, point.id, { lng: e.target.value ? Number(e.target.value) : null }))} />
        </div>
      </div>
      <div>
        <label className="field-label">Toelichting bij deze locatie (optioneel)</label>
        <textarea defaultValue={point.note ?? ""} className="input min-h-[60px]" placeholder="bijv. wat teams hier zien of moeten doen" onBlur={(e) => run(() => updatePoint(rallyId, point.id, { note: e.target.value }))} />
      </div>

      {isSF ? (
        <p className="rounded-soft bg-teal-light p-2.5 text-[13px] text-teal-dark">
          {point.kind === "start"
            ? "🚩 Dit is het startpunt (het eerste punt). Teams melden zich hier aan. Sleep punten of gebruik ▲/▼ om de volgorde te wijzigen."
            : "🏁 Dit is de finish (het laatste punt). Hier eindigt de rally. Sleep punten of gebruik ▲/▼ om de volgorde te wijzigen."}
        </p>
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
                Automatisch ontgrendelen bij aankomst (gps)
              </label>
              {point.gps_unlock ? (
                <div>
                  <label className="field-label">Ontgrendel-straal (m) — te voet ~25, met de auto ~75</label>
                  <input type="number" min={10} defaultValue={point.unlock_radius} className="input" onBlur={(e) => run(() => updatePoint(rallyId, point.id, { unlock_radius: Math.max(10, Number(e.target.value) || 50) }))} />
                </div>
              ) : null}

              <AssignmentConfig key={assignment.id + assignment.type} rallyId={rallyId} assignment={assignment} run={run} />
            </div>
          ) : (
            <p className="text-[13px] text-polder-grey">Dit punt is alleen een navigatiepunt — teams komen langs zonder opdracht.</p>
          )}
        </>
      )}

      <button className="btn btn-danger w-full text-sm" onClick={onDelete}>
        🗑️ Verwijder punt
      </button>
    </div>
  );
}

// ── settings: leg ────────────────────────────────────────────────────────────
function LegSettings({
  rallyId,
  leg,
  from,
  to,
  fromPoint,
  toPoint,
  run,
}: {
  rallyId: string;
  leg: Leg;
  from: string;
  to: string;
  fromPoint?: Point;
  toPoint?: Point;
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
        <div className="rounded-soft bg-teal-light p-3 text-[13px] text-teal-dark">
          🧭 De koers en afstand worden in de app <b>live berekend</b> vanaf de locatie van het team naar dit bestemmingspunt — je hoeft ze niet in te vullen. Zorg alleen dat het bestemmingspunt een goede gps-locatie heeft.
        </div>
      ) : null}

      {leg.nav_mode === "routebook" ? (
        <div>
          <label className="field-label">Routebeschrijving — één stap per regel</label>
          <textarea defaultValue={leg.steps ?? ""} className="input min-h-[90px]" onBlur={(e) => run(() => updateLeg(rallyId, leg.id, { steps: e.target.value }))} />
        </div>
      ) : null}

      {leg.nav_mode === "turn" ? <RoadbookEditor rallyId={rallyId} leg={leg} fromPoint={fromPoint} toPoint={toPoint} run={run} /> : null}

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
            <input type="number" min={0} defaultValue={leg.enroute_points} className="input" onBlur={(e) => run(() => updateLeg(rallyId, leg.id, { enroute_points: Number(e.target.value) }))} />
          </div>
          {leg.enroute_points > 0 ? (
            <div>
              <label className="field-label">Juist antwoord (nodig om te controleren)</label>
              <input defaultValue={leg.enroute_answer ?? ""} className="input" placeholder="bijv. 4" onBlur={(e) => run(() => updateLeg(rallyId, leg.id, { enroute_answer: e.target.value }))} />
              <p className="mt-1 text-xs text-polder-grey">De app controleert het antwoord automatisch en kent de punten toe.</p>
            </div>
          ) : (
            <p className="rounded-soft bg-purple-light p-2 text-xs font-semibold text-purple">
              💚 0 punten = kennismakingsvraag. Er is geen goed of fout — teams delen gewoon hun antwoord om elkaar beter te leren kennen.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── roadbook editor (bolletje-pijltje): draw on map + steps ──────────────────
function RoadbookEditor({ rallyId, leg, fromPoint, toPoint, run }: { rallyId: string; leg: Leg; fromPoint?: Point; toPoint?: Point; run: (fn: () => Promise<unknown>) => void }) {
  const steps: RoadbookStep[] = Array.isArray(leg.turn_steps) ? leg.turn_steps : [];
  const turnPoints = Array.isArray(leg.turn_points) ? leg.turn_points : [];
  const save = (next: RoadbookStep[]) => run(() => updateLeg(rallyId, leg.id, { turn_steps: next }));

  const start = fromPoint?.lat != null && fromPoint?.lng != null ? { lat: fromPoint.lat, lng: fromPoint.lng } : null;
  const end = toPoint?.lat != null && toPoint?.lng != null ? { lat: toPoint.lat, lng: toPoint.lng } : null;
  const path = [start, ...turnPoints, end].filter(Boolean) as { lat: number; lng: number }[];
  // live derived directions for the arrows on the map
  const derivedDirs = deriveRoadbook(path).map((s) => s.dir).slice(0, turnPoints.length);
  const [addMode, setAddMode] = useState(false);
  const [routing, setRouting] = useState(false);

  // Snap the route to the roads (OSRM), draw it, and use real road distances.
  async function saveTurnPoints(next: { lat: number; lng: number }[]) {
    const p = [start, ...next, end].filter(Boolean) as { lat: number; lng: number }[];
    setRouting(true);
    const road = await fetchRoadRoute(p);
    setRouting(false);
    const derived = deriveRoadbook(p, steps.map((s) => s.note), road?.legs);
    run(() => updateLeg(rallyId, leg.id, { turn_points: next, turn_steps: derived, turn_route: road?.route ?? [] }));
  }

  return (
    <div className="space-y-2">
      <label className="field-label">Roadbook op de kaart — klik de afslagpunten tussen start en eind</label>
      {!start || !end ? (
        <p className="rounded-soft bg-coral-light p-2 text-xs text-coral">Geef eerst het begin- en eindpunt van dit traject een gps-locatie (op de kaart of via lat/lng).</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-coral text-sm" onClick={() => setAddMode((v) => !v)}>
              {addMode ? "✖ Klaar met plaatsen" : "➕ Afslagpunt plaatsen"}
            </button>
            <button className="btn btn-ghost text-sm" onClick={() => void saveTurnPoints(turnPoints)}>🛣️ Route langs wegen bijwerken</button>
            {routing ? <span className="text-xs text-polder-grey">🛣️ route berekenen…</span> : null}
          </div>
          <RoadbookMap
            start={start}
            end={end}
            turnPoints={turnPoints}
            dirs={derivedDirs}
            route={leg.turn_route}
            addMode={addMode}
            onAddPoint={(lat, lng) => void saveTurnPoints([...turnPoints, { lat, lng }])}
            onMovePoint={(i, lat, lng) => void saveTurnPoints(turnPoints.map((t, j) => (j === i ? { lat, lng } : t)))}
          />
          <p className="text-xs text-polder-grey">De route wordt <b>langs de wegen</b> getekend (paars) met pijlen en echte weg-afstanden. Sleep een punt om het te verschuiven.</p>
        </>
      )}

      <label className="field-label mt-2">Stappen (automatisch berekend — pas gerust aan)</label>
      {steps.length === 0 ? <p className="text-xs text-polder-grey">Nog geen stappen. Teken de route op de kaart of voeg handmatig een stap toe.</p> : null}
      {steps.map((s, i) => (
        <div key={i} className="rounded-soft border-2 border-polder-line p-2">
          <div className="flex items-center gap-2">
            <span className="w-5 text-center text-xs font-bold text-polder-grey">{i + 1}</span>
            <input
              type="number"
              defaultValue={s.dist}
              className="input w-20"
              placeholder="m"
              onBlur={(e) => save(steps.map((x, j) => (j === i ? { ...x, dist: Number(e.target.value) || 0 } : x)))}
            />
            <span className="text-xs text-polder-grey">m</span>
            <select
              defaultValue={s.dir}
              className="input flex-1"
              onChange={(e) => save(steps.map((x, j) => (j === i ? { ...x, dir: e.target.value } : x)))}
            >
              {ROADBOOK_DIRS.map((d) => (
                <option key={d.id} value={d.id}>{d.icon} {d.label}</option>
              ))}
            </select>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              defaultValue={s.note}
              className="input flex-1"
              placeholder="toelichting (bijv. 'bij de kerk')"
              onBlur={(e) => save(steps.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))}
            />
            <button className="btn btn-ghost px-2 py-1 text-xs disabled:opacity-30" disabled={i === 0} onClick={() => { const c = [...steps]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; save(c); }}>▲</button>
            <button className="btn btn-ghost px-2 py-1 text-xs disabled:opacity-30" disabled={i === steps.length - 1} onClick={() => { const c = [...steps]; [c[i + 1], c[i]] = [c[i], c[i + 1]]; save(c); }}>▼</button>
            <button className="btn btn-danger px-2 py-1 text-xs" onClick={() => save(steps.filter((_, j) => j !== i))}>✕</button>
          </div>
        </div>
      ))}
      <button className="btn btn-ghost w-full text-sm" onClick={() => save([...steps, { dist: 0, dir: "straight", note: "" }])}>➕ Stap toevoegen</button>
    </div>
  );
}

// ── live view (teams volgen) ─────────────────────────────────────────────────
const TEAM_COLORS = ["#534AB7", "#D85A30", "#0E7490", "#7A5D00"];

function LiveView({
  rallyId,
  points,
  teams,
  activity,
  labelOf,
  onRefresh,
}: {
  rallyId: string;
  points: Point[];
  teams: LiveTeam[];
  activity: Record<string, ActivityItem[]>;
  labelOf: (p: Point) => string;
  onRefresh: () => void;
}) {
  const maxIndex = Math.max(1, points.length - 1);
  const [openTeam, setOpenTeam] = useState<string | null>(null);

  // Realtime: refresh team positions/scores as team_scores changes.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`live:${rallyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_scores", filter: `rally_id=eq.${rallyId}` }, onRefresh)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // onRefresh is stable enough (router.refresh); rallyId drives resubscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rallyId]);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[1fr_360px]">
      <div className="card">
        <h3 className="mb-2.5 text-sm font-bold uppercase tracking-wide text-teal-dark">Live kaart — posities van de teams</h3>
        <RallyMap
          points={points.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, label: labelOf(p), kind: p.kind }))}
          teams={teams
            .map((t, i): MapTeam | null => {
              const pos = geoPos(points, Math.min(1, t.current_index / maxIndex));
              return pos ? { id: t.id, name: t.name, lat: pos[0], lng: pos[1], color: TEAM_COLORS[i % 4] } : null;
            })
            .filter((x): x is MapTeam => x !== null)}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="rounded-soft border-[1.5px] border-dashed border-[#C9A227] bg-[#FFF9E8] p-2.5 text-[13px] text-[#6B5200]">
            👀 Alleen meekijken · <span className="font-bold text-teal">● live</span> — bijgewerkt zodra teams scoren.
          </div>
          <div className="flex gap-2">
            <Link href={`/ontwerp/${rallyId}/review`} className="btn btn-ghost text-sm">🔎 Nakijken</Link>
            <button className="btn btn-ghost text-sm" onClick={onRefresh}>🔄 Ververs</button>
          </div>
        </div>
      </div>
      <div className="card">
        <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-teal-dark">Ingeschreven teams ({teams.length})</h3>
        <p className="mb-2.5 text-xs text-polder-grey">Klik een team open om hun antwoorden en foto&apos;s te zien.</p>
        {teams.length ? (
          <div className="space-y-2">
            {teams.map((t, i) => {
              const items = activity[t.id] ?? [];
              const open = openTeam === t.id;
              return (
                <div key={t.id} className={`rounded-soft border-l-4 bg-white p-3 ${t.finished ? "border-coral" : "border-teal"}`}>
                  <button className="w-full text-left" onClick={() => setOpenTeam(open ? null : t.id)}>
                    <div className="flex items-center gap-2 font-bold">
                      <span className="inline-block h-3 w-3 rounded-full" style={{ background: TEAM_COLORS[i % 4] }} />
                      {t.name}
                      <span className="ml-auto text-teal-dark">{t.score} ptn</span>
                      <span className="text-xs text-polder-grey">{open ? "▲" : "▼"}</span>
                    </div>
                    <small className="mt-1 block text-xs text-polder-grey">
                      {t.finished ? "🏁 Gefinisht" : `Onderweg · punt ${t.current_index}`} · {t.hints} hint{t.hints === 1 ? "" : "s"} · {items.length} antwoord{items.length === 1 ? "" : "en"}
                    </small>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-polder-line">
                      <i className="block h-full rounded" style={{ width: `${Math.round(Math.min(1, t.current_index / maxIndex) * 100)}%`, background: t.finished ? "#D85A30" : "#1D9E75" }} />
                    </div>
                  </button>

                  {open ? (
                    <div className="mt-2.5 space-y-2 border-t border-polder-line pt-2.5">
                      {items.length === 0 ? (
                        <p className="text-xs text-polder-grey">Nog geen antwoorden.</p>
                      ) : (
                        items.map((it, k) => (
                          <div key={k} className="rounded-soft bg-paper p-2">
                            <div className="flex items-start gap-2">
                              <span className="flex-1 text-[13px] font-semibold text-ink">{it.label}</span>
                              <span className={`text-xs font-bold ${it.points < 0 ? "text-coral" : "text-teal-dark"}`}>
                                {it.points > 0 ? "+" : ""}{it.points}
                              </span>
                            </div>
                            {it.answer ? <p className="mt-0.5 text-[13px] text-polder-grey">Antwoord: <b className="text-ink">{it.answer}</b></p> : null}
                            {it.photoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <a href={it.photoUrl} target="_blank" rel="noreferrer">
                                <img src={it.photoUrl} alt="Bewijsfoto" className="mt-1 max-h-40 w-full rounded-soft object-cover" />
                              </a>
                            ) : null}
                            <p className="mt-0.5 text-[10px] text-polder-grey">{it.when}</p>
                          </div>
                        ))
                      )}
                      <Link href={`/ontwerp/${rallyId}/review`} className="btn btn-ghost w-full text-xs">🔎 Naar nakijken/corrigeren</Link>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-polder-grey">Nog geen teams. Zodra teams meedoen, verschijnen ze hier.</p>
        )}
      </div>
    </div>
  );
}

// ── geometry helpers ─────────────────────────────────────────────────────────
// Interpolated lat/lng position a fraction t along the route (points with gps).
function geoPos(points: Point[], t: number): [number, number] | null {
  const pts = points.filter((p) => p.lat != null && p.lng != null) as (Point & { lat: number; lng: number })[];
  if (pts.length === 0) return null;
  if (pts.length === 1) return [pts[0].lat, pts[0].lng];
  const seg: { a: [number, number]; b: [number, number]; len: number }[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a: [number, number] = [pts[i].lat, pts[i].lng];
    const b: [number, number] = [pts[i + 1].lat, pts[i + 1].lng];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
    seg.push({ a, b, len });
    total += len;
  }
  let d = Math.min(1, Math.max(0, t)) * total;
  for (const s of seg) {
    if (d <= s.len) {
      const f = d / s.len;
      return [s.a[0] + (s.b[0] - s.a[0]) * f, s.a[1] + (s.b[1] - s.a[1]) * f];
    }
    d -= s.len;
  }
  const last = pts[pts.length - 1];
  return [last.lat, last.lng];
}

function legSummary(l: Leg): string {
  if (l.nav_mode === "compass") return "kompas — live koers + afstand";
  if (l.nav_mode === "map") return l.note || "teams volgen de kaartlijn";
  if (l.nav_mode === "turn") return l.turn_steps?.length ? `roadbook — ${l.turn_steps.length} stap${l.turn_steps.length === 1 ? "" : "pen"}` : "roadbook nog invullen";
  const first = (l.steps ?? "").split("\n").filter(Boolean);
  return first.length ? `${first.length} instructie${first.length === 1 ? "" : "s"} — "${first[0]}"` : "instructies nog invullen";
}
