"use client";

import { deleteRally } from "@/lib/designer/actions";

// Delete a rally from the overview list, behind a confirmation so a whole rally
// (with all its teams and scores) can't be wiped by an accidental tap.
export default function DeleteRallyButton({ rallyId, rallyName }: { rallyId: string; rallyName: string }) {
  return (
    <form
      action={deleteRally.bind(null, rallyId)}
      onSubmit={(e) => {
        if (!confirm(`Weet je zeker dat je "${rallyName}" verwijdert?\n\nAlle teams en scores van deze rally verdwijnen definitief. Dit kan niet ongedaan worden gemaakt.`)) {
          e.preventDefault();
        }
      }}
    >
      <button className="btn btn-danger text-sm" type="submit" aria-label={`Verwijder ${rallyName}`}>🗑️</button>
    </form>
  );
}
