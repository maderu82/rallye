import type { Assignment } from "./types";

// ============================================================================
// Answer grading (server-only). Consumes the hidden `solution`; never runs in
// the browser. Implements the point arithmetic of spec §3.3 / §4.
// ============================================================================

export interface GradeResult {
  /** Whether this action completes the assignment (unlocks "next waypoint"). */
  complete: boolean;
  /** Points to add (may be negative for a penalty). */
  delta: number;
  /** Whether the submitted answer was correct/accepted. */
  ok: boolean;
  feedback: string;
  kind: "assignment" | "penalty" | "manual";
  needsReview?: boolean;
  /** Optional badge earned by this action. */
  badge?: { name: string; icon: string };
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalize(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function grade(
  a: Pick<Assignment, "type" | "points" | "public_config" | "solution">,
  submission: Record<string, unknown>,
): GradeResult {
  const sol = a.solution ?? {};
  const cfg = a.public_config ?? {};

  // wrong-answer penalty helper (applied on incorrect, retry-allowed answers)
  const wrong = (msg: string): GradeResult => {
    const pen = num(sol.wrongPenalty, 0);
    return {
      complete: false,
      delta: -pen,
      ok: false,
      feedback: pen > 0 ? `${msg} (−${pen} punten)` : msg,
      kind: pen > 0 ? "penalty" : "assignment",
    };
  };

  switch (a.type) {
    case "multiple_choice": {
      const ok = String(submission.choice) === String(sol.correct);
      return ok
        ? { complete: true, delta: a.points, ok, feedback: "✅ Goed beantwoord!", kind: "assignment" }
        : wrong("❌ Helaas, dat klopt niet. Probeer opnieuw!");
    }

    case "open_question":
    case "observation": {
      const accepted = Array.isArray(sol.answers)
        ? (sol.answers as unknown[]).map(normalize)
        : [normalize(sol.answer)];
      const ok = accepted.includes(normalize(submission.text));
      return ok
        ? { complete: true, delta: a.points, ok, feedback: "✅ Correct!", kind: "assignment" }
        : wrong("❌ Dat is niet het juiste antwoord.");
    }

    case "code_breaker": {
      const ok = normalize(submission.code) === normalize(sol.code);
      return ok
        ? { complete: true, delta: a.points, ok, feedback: "✅ Klik! Het slot springt open.", kind: "assignment" }
        : wrong("❌ Het slot blijft dicht. Probeer een andere code.");
    }

    case "ordering": {
      const submitted = Array.isArray(submission.order) ? submission.order.map(String) : [];
      const correct = Array.isArray(sol.order) ? (sol.order as unknown[]).map(String) : [];
      const ok = submitted.length === correct.length && submitted.every((v, i) => v === correct[i]);
      return ok
        ? { complete: true, delta: a.points, ok, feedback: "✅ Juiste volgorde!", kind: "assignment" }
        : { complete: false, delta: 0, ok, feedback: "❌ Nog niet in de juiste volgorde.", kind: "assignment" };
    }

    case "estimation": {
      // SCALE: full points within margin, linearly down to 0 at maxOff away.
      const target = num(sol.target);
      const margin = num(sol.margin, 0);
      const maxOff = num(sol.maxOff, margin * 4 || 1);
      const off = Math.abs(num(submission.value) - target);
      let delta = a.points;
      if (off > margin) {
        const frac = Math.max(0, 1 - (off - margin) / Math.max(1, maxOff - margin));
        delta = Math.round(a.points * frac);
      }
      return {
        complete: true,
        delta,
        ok: delta > 0,
        feedback: `📏 Afwijking ${off} → ${delta} punten`,
        kind: "assignment",
      };
    }

    case "qr_checkpoint": {
      return { complete: true, delta: a.points, ok: true, feedback: "✅ Checkpoint bevestigd!", kind: "assignment" };
    }

    case "qr_search": {
      const ok = String(submission.sign) === String(sol.correct);
      if (ok) {
        return { complete: true, delta: a.points, ok, feedback: "✅ Het juiste bordje! Goed gespeurd.", kind: "assignment" };
      }
      const penalty = num(sol.wrongPenalty, 5);
      return {
        complete: false,
        delta: -penalty,
        ok,
        feedback: `❌ Fout bordje: −${penalty} punten. Probeer een ander bordje!`,
        kind: "penalty",
      };
    }

    case "speed_test": {
      // SCALE: max points at target, minus penaltyPerKmh per km/u deviation.
      const target = num(cfg.target, 38);
      const maxPoints = num(cfg.maxPoints, a.points);
      const penaltyPerKmh = num(cfg.penaltyPerKmh, 3);
      const v = num(submission.value);
      const diff = Math.abs(v - target);
      const delta = Math.max(0, Math.round(maxPoints - diff * penaltyPerKmh));
      const result: GradeResult = {
        complete: true,
        delta,
        ok: delta > 0,
        feedback: `${delta > 0 ? "✅" : "⚠️"} Gemiddelde ${v} km/u (afwijking ${diff}) → ${delta} punten`,
        kind: "assignment",
      };
      if (diff === 0) result.badge = { name: "Kilometerkoning", icon: "⏱️" };
      return result;
    }

    case "compass_point": {
      // Navigation-only AUTO point: arriving scores.
      return { complete: true, delta: a.points, ok: true, feedback: "✅ Punt bereikt op koers!", kind: "assignment" };
    }

    case "photo_search": {
      // AUTO on submission; organizer may review afterwards.
      return {
        complete: true,
        delta: a.points,
        ok: true,
        feedback: "✅ Foto ingestuurd als bewijs!",
        kind: "assignment",
        needsReview: true,
      };
    }

    case "free_game": {
      // MANUAL: team/host enters a score, clamped to [0, max].
      const max = num(cfg.max, a.points);
      const per = num(cfg.perUnit, 1);
      const units = Math.max(0, Math.min(max, Math.round(num(submission.selfScore))));
      const delta = units * per;
      const result: GradeResult = {
        complete: true,
        delta,
        ok: true,
        feedback: `✅ Score ingediend: ${units} → +${delta} punten.`,
        kind: "manual",
        needsReview: true,
      };
      return result;
    }

    default:
      return { complete: false, delta: 0, ok: false, feedback: "Onbekend opdrachttype.", kind: "assignment" };
  }
}
