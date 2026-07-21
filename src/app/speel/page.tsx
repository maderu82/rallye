import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { TEAM_COOKIE } from "@/lib/play/constants";
import JoinForm from "./JoinForm";

export const dynamic = "force-dynamic";

export default async function SpeelPage() {
  // If an active team session already exists, jump straight into the rally.
  const token = (await cookies()).get(TEAM_COOKIE)?.value;
  if (token) {
    const db = createAdminClient();
    const { data: team } = await db.from("teams").select("id").eq("session_token", token).maybeSingle();
    if (team) redirect("/speel/rally");
  }

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-[440px] flex-col justify-center px-5 py-10">
      <div className="mb-4 text-center">
        <Link href="/" className="text-sm font-bold text-teal-dark">
          ← Startscherm
        </Link>
      </div>
      <div className="card p-7">
        <div className="text-center text-[44px]">🧭</div>
        <h1 className="text-center text-[20px] font-bold text-teal-dark">Meedoen aan een rally</h1>
        <p className="mb-4 mt-1 text-center text-sm text-polder-grey">
          Eén telefoon per team. Voer je teamcode in en kies een teamnaam — geen account nodig.
        </p>
        <JoinForm />
        <div className="mt-4 rounded-soft border-[1.5px] border-dashed border-[#C9A227] bg-[#FFF9E8] p-2.5 text-[13px] text-[#6B5200]">
          🧪 Demo-teamcode: <b>RLY-7H2K</b> (de &ldquo;Polderpuzzel rallye&rdquo;).
        </div>
      </div>
    </main>
  );
}
