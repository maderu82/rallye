import { cookies } from "next/headers";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { TEAM_COOKIE } from "@/lib/play/constants";
import { leaveTeam } from "@/lib/play/actions";
import JoinForm from "./JoinForm";

export const dynamic = "force-dynamic";

export default async function SpeelPage() {
  // If a team session already exists, don't silently resume — offer a choice.
  const token = (await cookies()).get(TEAM_COOKIE)?.value;
  let existing: { name: string } | null = null;
  if (token) {
    const db = createAdminClient();
    const { data: team } = await db.from("teams").select("name").eq("session_token", token).maybeSingle();
    if (team) existing = team;
  }

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-[440px] flex-col justify-center px-5 py-10">
      <div className="mb-4 text-center">
        <Link href="/" className="text-sm font-bold text-teal-dark">
          ← Startscherm
        </Link>
      </div>

      {existing ? (
        <div className="card mb-4 p-5 text-center">
          <h1 className="text-[18px] font-bold text-teal-dark">Je speelt al mee</h1>
          <p className="mb-3 mt-1 text-sm text-polder-grey">
            Actieve sessie voor team <b className="text-teal-dark">{existing.name}</b>.
          </p>
          <Link href="/speel/rally" className="btn btn-primary w-full">▶️ Verder spelen</Link>
          <form action={leaveTeam} className="mt-2">
            <button type="submit" className="btn btn-ghost w-full">Sessie verlaten</button>
          </form>
        </div>
      ) : null}

      <div className="card p-7">
        <div className="text-center text-[44px]">🧭</div>
        <h1 className="text-center text-[20px] font-bold text-teal-dark">
          {existing ? "Meedoen aan een andere rally" : "Meedoen aan een rally"}
        </h1>
        <p className="mb-4 mt-1 text-center text-sm text-polder-grey">
          Eén telefoon per team. Voer je teamcode in en kies een teamnaam — geen account nodig.
          {existing ? " Een nieuwe code brengt je naar die rally." : ""}
        </p>
        <JoinForm />
        <div className="mt-4 rounded-soft border-[1.5px] border-dashed border-[#C9A227] bg-[#FFF9E8] p-2.5 text-[13px] text-[#6B5200]">
          🧪 Demo-teamcode: <b>RLY-7H2K</b> (de &ldquo;Polderpuzzel rallye&rdquo;).
        </div>
      </div>
    </main>
  );
}
