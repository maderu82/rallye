import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createRally } from "@/lib/designer/actions";
import { logout } from "@/lib/auth/actions";
import DeleteRallyButton from "./DeleteRallyButton";

export const dynamic = "force-dynamic";

export default async function DesignerHome() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  const { data: rallies } = await db
    .from("rallies")
    .select("id,name,join_code,published,updated_at")
    .order("updated_at", { ascending: false });

  return (
    <main className="mx-auto max-w-[1000px] px-5 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link href="/" className="btn btn-ghost">← Startscherm</Link>
        <h1 className="flex-1 text-2xl font-bold text-teal-dark">🗺️ Ontwerpersportaal</h1>
        <span className="text-sm text-polder-grey">{user?.email}</span>
        <form action={logout}>
          <button className="btn btn-ghost" type="submit">🔒 Uitloggen</button>
        </form>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-teal-dark">Jouw rally&apos;s</h2>
          {rallies?.length ? (
            <ul className="space-y-2">
              {rallies.map((r) => (
                <li key={r.id} className="flex items-center gap-2 rounded-soft bg-paper p-3">
                  <div className="flex-1">
                    <Link href={`/ontwerp/${r.id}`} className="font-bold text-teal-dark hover:underline">
                      {r.name}
                    </Link>
                    <div className="text-xs text-polder-grey">
                      Code {r.join_code} ·{" "}
                      {r.published ? (
                        <span className="font-bold text-teal">gepubliceerd</span>
                      ) : (
                        <span>concept</span>
                      )}
                    </div>
                  </div>
                  <Link href={`/ontwerp/${r.id}`} className="btn btn-ghost text-sm">Bewerken</Link>
                  <DeleteRallyButton rallyId={r.id} rallyName={r.name} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-polder-grey">Nog geen rally&apos;s. Maak er hiernaast een aan.</p>
          )}
        </section>

        <section className="card">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-teal-dark">Nieuwe rally</h2>
          <form action={createRally} className="space-y-3">
            <div>
              <label className="field-label" htmlFor="name">Naam</label>
              <input id="name" name="name" className="input" placeholder="bijv. Polderpuzzel rallye" required />
            </div>
            <button className="btn btn-primary w-full" type="submit">➕ Rally aanmaken</button>
          </form>
          <p className="mt-3 text-xs text-polder-grey">
            Een nieuwe rally start met een Start- en Finishpunt. Voeg daarna waypoints, opdrachten en
            trajecten toe in de editor.
          </p>
        </section>
      </div>
    </main>
  );
}
