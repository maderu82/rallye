"use client";

import { restoreRally, hardDeleteRally } from "@/lib/designer/actions";

// A single row in the rally trash: restore it, or permanently delete it behind
// a strong confirmation (permanent delete cannot be undone).
export default function TrashRallyRow({
  rallyId,
  rallyName,
  deletedAt,
}: {
  rallyId: string;
  rallyName: string;
  deletedAt: string | null;
}) {
  const when = deletedAt ? new Date(deletedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) : "";
  return (
    <li className="flex items-center gap-2 rounded-soft bg-paper p-3 opacity-90">
      <div className="flex-1">
        <span className="font-bold text-polder-grey line-through">{rallyName}</span>
        <div className="text-xs text-polder-grey">In prullenbak{when ? ` · ${when}` : ""}</div>
      </div>
      <form action={restoreRally.bind(null, rallyId)}>
        <button className="btn btn-ghost text-sm" type="submit">↩︎ Herstellen</button>
      </form>
      <form
        action={hardDeleteRally.bind(null, rallyId)}
        onSubmit={(e) => {
          if (!confirm(`"${rallyName}" DEFINITIEF verwijderen?\n\nDit verwijdert de rally met alle teams en scores voorgoed. Dit kan niet ongedaan worden gemaakt.`)) {
            e.preventDefault();
          }
        }}
      >
        <button className="btn btn-danger text-sm" type="submit" aria-label={`Definitief verwijderen ${rallyName}`}>🗑️ Definitief</button>
      </form>
    </li>
  );
}
