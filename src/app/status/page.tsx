import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// A no-jargon health page: shows which Supabase project the app is connected to
// and whether the schema, the demo rally and organizer accounts are present —
// so the "wrong project" problem is visible without DevTools or SQL.
export default async function StatusPage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const host = url.replace(/^https?:\/\//, "").replace(/\.supabase\.co.*/, "");
  const hasEnv = Boolean(url && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const hasService = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  let tablesOk = false;
  let rallyCount = 0;
  let demoPresent = false;
  let userCount: number | null = null;
  let errorMsg = "";

  if (hasEnv && hasService) {
    try {
      const db = createAdminClient();
      const { count, error } = await db.from("rallies").select("*", { count: "exact", head: true });
      if (error) {
        errorMsg = error.message;
      } else {
        tablesOk = true;
        rallyCount = count ?? 0;
      }
      const { data: demo } = await db.from("rallies").select("id").eq("join_code", "RLY-7H2K").maybeSingle();
      demoPresent = Boolean(demo);
      const { data: users } = await db.auth.admin.listUsers();
      userCount = users?.users.length ?? 0;
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    }
  }

  const Row = ({ ok, label, detail }: { ok: boolean; label: string; detail: string }) => (
    <div className="flex items-start gap-3 rounded-soft bg-white p-3 shadow-soft">
      <span className={`mt-0.5 text-lg ${ok ? "text-teal" : "text-coral"}`}>{ok ? "✅" : "❌"}</span>
      <div>
        <div className="font-bold text-ink">{label}</div>
        <div className="text-sm text-polder-grey">{detail}</div>
      </div>
    </div>
  );

  const allGood = hasEnv && hasService && tablesOk && (userCount ?? 0) > 0;

  return (
    <main className="mx-auto max-w-[560px] px-5 py-10">
      <div className="mb-4 text-center">
        <Link href="/" className="text-sm font-bold text-teal-dark">← Startscherm</Link>
      </div>
      <h1 className="mb-1 text-2xl font-bold text-teal-dark">🔧 Status</h1>
      <p className="mb-5 text-sm text-polder-grey">Snelle check of de app goed aan Supabase gekoppeld is.</p>

      <div className="space-y-2.5">
        <Row ok={hasEnv} label="App gekoppeld aan Supabase" detail={host ? `Project: ${host}` : "Geen Supabase-URL ingesteld in Vercel."} />
        <Row ok={hasService} label="Service-role sleutel aanwezig" detail={hasService ? "OK" : "SUPABASE_SERVICE_ROLE_KEY ontbreekt in Vercel."} />
        <Row ok={tablesOk} label="Database-tabellen aanwezig" detail={tablesOk ? `${rallyCount} rally('s) gevonden` : errorMsg || "Tabellen niet gevonden — draai setup.sql in dit project."} />
        <Row ok={demoPresent} label="Demo-rally (code RLY-7H2K)" detail={demoPresent ? "Aanwezig — je kunt direct spelen." : "Niet aanwezig (optioneel)."} />
        <Row
          ok={(userCount ?? 0) > 0}
          label="Organisator-accounts in dit project"
          detail={
            userCount === null
              ? "Kon niet controleren."
              : userCount === 0
                ? "0 gebruikers — je login-account staat NIET in dit project. Maak het hier aan (Authentication → Users → Add user → Auto Confirm), of laat Vercel naar het juiste project wijzen."
                : `${userCount} gebruiker(s) — inloggen zou moeten werken.`
          }
        />
      </div>

      <div className={`mt-5 rounded-card p-4 text-sm font-semibold ${allGood ? "bg-teal-light text-teal-dark" : "bg-coral-light text-coral"}`}>
        {allGood
          ? "🎉 Alles staat goed. Ga naar 'Ontwerp een rallye' en log in."
          : "Los de rode punten hierboven op — allemaal in HETZELFDE Supabase-project dat bovenaan staat."}
      </div>

      <div className="mt-5 flex gap-2">
        <Link href="/ontwerp/login" className="btn btn-primary flex-1">Naar inloggen →</Link>
        <Link href="/speel" className="btn btn-ghost flex-1">Speel de demo</Link>
      </div>
    </main>
  );
}
