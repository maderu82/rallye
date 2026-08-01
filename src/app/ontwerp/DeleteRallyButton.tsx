"use client";

import { deleteRally } from "@/lib/designer/actions";

// Move a rally to the trash from the overview list, behind a confirmation. It's
// recoverable — permanent deletion happens from the trash.
export default function DeleteRallyButton({ rallyId, rallyName }: { rallyId: string; rallyName: string }) {
  return (
    <form
      action={deleteRally.bind(null, rallyId)}
      onSubmit={(e) => {
        if (!confirm(`"${rallyName}" naar de prullenbak verplaatsen?\n\nDe rally wordt verborgen maar bewaard — je kunt 'm herstellen of later definitief verwijderen.`)) {
          e.preventDefault();
        }
      }}
    >
      <button className="btn btn-danger text-sm" type="submit" aria-label={`Verwijder ${rallyName}`}>🗑️</button>
    </form>
  );
}
