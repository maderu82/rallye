"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewSubmission } from "@/lib/designer/actions";

export default function ReviewForm({
  rallyId,
  eventId,
  awarded,
}: {
  rallyId: string;
  eventId: string;
  awarded: number;
}) {
  const router = useRouter();
  const [points, setPoints] = useState(awarded);
  const [pending, start] = useTransition();

  function save(finalPoints: number) {
    start(async () => {
      await reviewSubmission(rallyId, eventId, finalPoints);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs font-bold uppercase text-polder-grey">Punten</label>
      <input
        type="number"
        value={points}
        onChange={(e) => setPoints(Number(e.target.value))}
        className="input w-20"
      />
      <button className="btn btn-primary flex-1 text-sm" disabled={pending} onClick={() => save(points)}>
        {pending ? "Opslaan…" : "✓ Vastleggen"}
      </button>
      <button
        className="btn btn-danger text-sm"
        disabled={pending}
        title="0 punten toekennen"
        onClick={() => {
          setPoints(0);
          save(0);
        }}
      >
        Afkeuren
      </button>
    </div>
  );
}
