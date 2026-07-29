"use client";

import type { Assignment } from "@/lib/types";
import { updateAssignment } from "@/lib/designer/actions";
import QRImage from "@/components/QRImage";

// Per-building-block configuration: answers, options, penalties, ranges, etc.
// Writes to public_config (safe for players) and solution (server-only answer key).
export default function AssignmentConfig({
  rallyId,
  assignment,
  run,
}: {
  rallyId: string;
  assignment: Assignment;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const cfg = (assignment.public_config ?? {}) as Record<string, unknown>;
  const sol = (assignment.solution ?? {}) as Record<string, unknown>;
  const pid = assignment.point_id;

  const savePublic = (patch: Record<string, unknown>) =>
    run(() => updateAssignment(rallyId, pid, { public_config: { ...cfg, ...patch } }));
  const saveSolution = (patch: Record<string, unknown>) =>
    run(() => updateAssignment(rallyId, pid, { solution: { ...sol, ...patch } }));

  const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const str = (v: unknown) => (v == null ? "" : String(v));

  const wrongPenaltyField = (
    <div>
      <label className="field-label">Puntenaftrek bij fout antwoord</label>
      <input
        type="number"
        min={0}
        defaultValue={num(sol.wrongPenalty)}
        className="input"
        onBlur={(e) => saveSolution({ wrongPenalty: num(e.target.value) })}
      />
    </div>
  );

  switch (assignment.type) {
    case "multiple_choice": {
      const options = (Array.isArray(cfg.options) ? cfg.options : []) as { id: string; label: string }[];
      const nextId = () => String.fromCharCode(65 + options.length); // A, B, C…
      return (
        <div className="space-y-2.5 rounded-soft bg-white p-3">
          <label className="field-label">Antwoordopties (kies de juiste)</label>
          {options.map((o, i) => (
            <div key={o.id} className="flex items-center gap-2">
              <input
                type="radio"
                name={`correct-${pid}`}
                checked={String(sol.correct) === o.id}
                onChange={() => saveSolution({ correct: o.id })}
                className="accent-teal"
                title="Juiste antwoord"
              />
              <span className="w-5 text-xs font-bold text-polder-grey">{o.id}</span>
              <input
                defaultValue={o.label}
                className="input flex-1"
                onBlur={(e) => {
                  const copy = options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x));
                  savePublic({ options: copy });
                }}
              />
              <button
                className="btn btn-danger px-2 text-xs"
                onClick={() => {
                  const copy = options.filter((_, j) => j !== i);
                  savePublic({ options: copy });
                }}
              >
                ✕
              </button>
            </div>
          ))}
          <button className="btn btn-ghost w-full text-sm" onClick={() => savePublic({ options: [...options, { id: nextId(), label: "" }] })}>
            ➕ Optie toevoegen
          </button>
          {wrongPenaltyField}
        </div>
      );
    }

    case "open_question":
    case "observation":
      return (
        <div className="space-y-2.5 rounded-soft bg-white p-3">
          <div>
            <label className="field-label">Juist antwoord</label>
            <input defaultValue={str(sol.answer)} className="input" onBlur={(e) => saveSolution({ answer: e.target.value })} />
            <p className="mt-1 text-xs text-polder-grey">Hoofdletters/spaties maken niet uit.</p>
          </div>
          {wrongPenaltyField}
        </div>
      );

    case "code_breaker":
      return (
        <div className="space-y-2.5 rounded-soft bg-white p-3">
          <div>
            <label className="field-label">Antwoord / code (cijfers of tekst — ook voor rebus)</label>
            <input defaultValue={str(sol.code)} className="input" placeholder="bijv. 1894 of ROOS" onBlur={(e) => saveSolution({ code: e.target.value })} />
          </div>
          <div>
            <label className="field-label">Raadsel / toelichting (optioneel)</label>
            <input defaultValue={str(cfg.riddle)} className="input" onBlur={(e) => savePublic({ riddle: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="field-label">Kosten per cijfer kopen</label>
              <input type="number" min={0} defaultValue={num(sol.digitCost, 10)} className="input" onBlur={(e) => { const v = num(e.target.value, 10); saveSolution({ digitCost: v }); savePublic({ digitCost: v }); }} />
            </div>
            <div>{wrongPenaltyField}</div>
          </div>
          <p className="text-xs text-polder-grey">Bij een numerieke code kunnen teams (na de hint) cijfers kopen. Bij tekst/rebus werkt alleen de hint.</p>
        </div>
      );

    case "estimation":
      return (
        <div className="space-y-2.5 rounded-soft bg-white p-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="field-label">Juiste waarde</label>
              <input type="number" defaultValue={str(sol.target)} className="input" onBlur={(e) => saveSolution({ target: num(e.target.value) })} />
            </div>
            <div>
              <label className="field-label">Eenheid (optioneel)</label>
              <input defaultValue={str(cfg.unit)} className="input" placeholder="bijv. m, jaar" onBlur={(e) => savePublic({ unit: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="field-label">Marge (± volledige punten)</label>
              <input type="number" min={0} defaultValue={num(sol.margin)} className="input" onBlur={(e) => saveSolution({ margin: num(e.target.value) })} />
            </div>
            <div>
              <label className="field-label">Vanaf afwijking = 0 punten</label>
              <input type="number" min={0} defaultValue={num(sol.maxOff)} className="input" onBlur={(e) => saveSolution({ maxOff: num(e.target.value) })} />
            </div>
          </div>
          <p className="text-xs text-polder-grey">Binnen de marge: volle punten. Daarbuiten lopen de punten af tot 0 bij de opgegeven afwijking.</p>
        </div>
      );

    case "ordering": {
      const items = (Array.isArray(cfg.items) ? cfg.items : []) as string[];
      return (
        <div className="space-y-2.5 rounded-soft bg-white p-3">
          <label className="field-label">Items in de JUISTE volgorde (één per regel)</label>
          <textarea
            defaultValue={items.join("\n")}
            className="input min-h-[90px]"
            placeholder={"1866\n1901\n1932"}
            onBlur={(e) => {
              const list = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
              savePublic({ items: list });
              saveSolution({ order: list });
            }}
          />
          <p className="text-xs text-polder-grey">Teams zien de items door elkaar en zetten ze in de goede volgorde.</p>
          {wrongPenaltyField}
        </div>
      );
    }

    case "speed_test":
      return (
        <div className="grid grid-cols-2 gap-2 rounded-soft bg-white p-3">
          <div>
            <label className="field-label">Doel-gemiddelde (km/u)</label>
            <input type="number" defaultValue={num(cfg.target, 30)} className="input" onBlur={(e) => savePublic({ target: num(e.target.value, 30) })} />
          </div>
          <div>
            <label className="field-label">Max. punten</label>
            <input type="number" defaultValue={num(cfg.maxPoints, assignment.points)} className="input" onBlur={(e) => savePublic({ maxPoints: num(e.target.value) })} />
          </div>
          <div>
            <label className="field-label">Aftrek per km/u afwijking</label>
            <input type="number" defaultValue={num(cfg.penaltyPerKmh, 3)} className="input" onBlur={(e) => savePublic({ penaltyPerKmh: num(e.target.value, 3) })} />
          </div>
          <div>
            <label className="field-label">Schuif min–max</label>
            <div className="flex gap-1">
              <input type="number" defaultValue={num(cfg.min, 20)} className="input" onBlur={(e) => savePublic({ min: num(e.target.value, 20) })} />
              <input type="number" defaultValue={num(cfg.max, 56)} className="input" onBlur={(e) => savePublic({ max: num(e.target.value, 56) })} />
            </div>
          </div>
        </div>
      );

    case "free_game":
      return (
        <div className="grid grid-cols-2 gap-2 rounded-soft bg-white p-3">
          <div>
            <label className="field-label">Punten per eenheid</label>
            <input type="number" defaultValue={num(cfg.perUnit, 1)} className="input" onBlur={(e) => savePublic({ perUnit: num(e.target.value, 1) })} />
          </div>
          <div>
            <label className="field-label">Max. score</label>
            <input type="number" defaultValue={num(cfg.max, 15)} className="input" onBlur={(e) => savePublic({ max: num(e.target.value, 15) })} />
          </div>
          <div className="col-span-2">
            <label className="field-label">Naam eenheid</label>
            <input defaultValue={str(cfg.unitLabel || "punt")} className="input" onBlur={(e) => savePublic({ unitLabel: e.target.value })} />
          </div>
        </div>
      );

    case "video_task":
      return (
        <div className="space-y-2 rounded-soft bg-white p-3">
          <label className="field-label">Maximale lengte van het filmpje</label>
          <select
            defaultValue={String(num(cfg.maxSec, 10))}
            className="input"
            onChange={(e) => savePublic({ maxSec: num(e.target.value, 10) })}
          >
            <option value="10">10 seconden</option>
            <option value="15">15 seconden</option>
            <option value="20">20 seconden</option>
            <option value="30">30 seconden</option>
            <option value="60">60 seconden</option>
          </select>
          <p className="text-[13px] text-polder-grey">Langere filmpjes worden geweigerd vóór het uploaden. Houd het kort zodat uploads klein blijven.</p>
        </div>
      );

    case "qr_checkpoint":
      return (
        <div className="space-y-2 rounded-soft bg-white p-3">
          <p className="text-[13px] text-polder-grey">Print deze QR en hang &apos;m op de locatie. Teams scannen &apos;m als bewijs van aanwezigheid.</p>
          <QRImage value={`RLYCHK:${assignment.id}`} label="Checkpoint" />
        </div>
      );

    case "qr_search": {
      const signs = (Array.isArray(cfg.signs) && cfg.signs.length ? cfg.signs : ["A", "B", "C"]) as string[];
      const nextLabel = () => String.fromCharCode(65 + signs.length);
      return (
        <div className="space-y-2.5 rounded-soft bg-white p-3">
          <label className="field-label">Bordjes — kies het juiste; print elke QR en hang ze in het veld</label>
          {signs.map((s, i) => {
            const correct = String(sol.correct) === s;
            return (
              <div key={i} className={`rounded-soft border-2 p-2 ${correct ? "border-teal bg-teal-light" : "border-polder-line"}`}>
                <div className="flex items-center gap-2">
                  <input type="radio" name={`qrcorrect-${pid}`} checked={correct} onChange={() => saveSolution({ correct: s })} className="accent-teal" title="Juiste bordje" />
                  <input
                    defaultValue={s}
                    className="input flex-1"
                    onBlur={(e) => {
                      const v = e.target.value.trim() || s;
                      const copy = signs.map((x, j) => (j === i ? v : x));
                      savePublic({ signs: copy });
                      if (correct) saveSolution({ correct: v });
                    }}
                  />
                  <button className="btn btn-danger px-2 text-xs" onClick={() => savePublic({ signs: signs.filter((_, j) => j !== i) })}>✕</button>
                </div>
                <div className="mt-2">
                  <QRImage value={`RLYSIGN:${assignment.id}:${s}`} label={`Bordje ${s}${correct ? " ✓ juist" : ""}`} />
                </div>
              </div>
            );
          })}
          <button className="btn btn-ghost w-full text-sm" onClick={() => savePublic({ signs: [...signs, nextLabel()] })}>➕ Bordje toevoegen</button>
          {wrongPenaltyField}
        </div>
      );
    }

    default:
      return null;
  }
}
