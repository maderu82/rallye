import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BLOCK_BY_TYPE } from "@/lib/blocks";
import ReviewForm from "./ReviewForm";

export const dynamic = "force-dynamic";

type ReviewItem = {
  id: string;
  teamName: string;
  awarded: number;
  prompt: string;
  typeLabel: string;
  createdAt: string;
  photoUrl: string | null;
};

export default async function ReviewPage({ params }: { params: Promise<{ rallyId: string }> }) {
  const { rallyId } = await params;
  const db = await createClient();

  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/ontwerp/login");

  const { data: rally } = await db.from("rallies").select("id,name,owner_id").eq("id", rallyId).maybeSingle();
  if (!rally) notFound();
  if (rally.owner_id !== user.id) redirect("/ontwerp");

  const admin = createAdminClient();
  const { data: events } = await admin
    .from("team_events")
    .select("id,team_id,assignment_id,points_delta,photo_path,created_at")
    .eq("rally_id", rallyId)
    .eq("needs_review", true)
    .order("created_at", { ascending: false });

  const teamIds = [...new Set((events ?? []).map((e) => e.team_id))];
  const assignmentIds = [...new Set((events ?? []).map((e) => e.assignment_id).filter(Boolean))] as string[];
  const [{ data: teams }, { data: assignments }] = await Promise.all([
    teamIds.length ? admin.from("teams").select("id,name").in("id", teamIds) : Promise.resolve({ data: [] }),
    assignmentIds.length ? admin.from("assignments").select("id,prompt,type,points").in("id", assignmentIds) : Promise.resolve({ data: [] }),
  ]);
  const teamName = new Map((teams ?? []).map((t) => [t.id, t.name]));
  const asg = new Map((assignments ?? []).map((a) => [a.id, a]));

  const items: ReviewItem[] = await Promise.all(
    (events ?? []).map(async (e) => {
      let photoUrl: string | null = null;
      if (e.photo_path) {
        const { data } = await admin.storage.from("proof-photos").createSignedUrl(e.photo_path, 3600);
        photoUrl = data?.signedUrl ?? null;
      }
      const a = e.assignment_id ? asg.get(e.assignment_id) : undefined;
      return {
        id: e.id,
        teamName: teamName.get(e.team_id) ?? "Onbekend team",
        awarded: e.points_delta,
        prompt: a?.prompt ?? "—",
        typeLabel: a ? BLOCK_BY_TYPE[a.type as keyof typeof BLOCK_BY_TYPE].label : "Inzending",
        createdAt: new Date(e.created_at).toLocaleString("nl-NL"),
        photoUrl,
      };
    }),
  );

  return (
    <main className="mx-auto max-w-[900px] px-5 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link href={`/ontwerp/${rallyId}`} className="btn btn-ghost">← Editor</Link>
        <h1 className="flex-1 text-2xl font-bold text-teal-dark">🔎 Nakijken — {rally.name}</h1>
        <span className="chip chip-teal">{items.length} te beoordelen</span>
      </div>

      {items.length === 0 ? (
        <div className="card text-center text-polder-grey">
          Niets te beoordelen. Foto-inzendingen en handmatige scores verschijnen hier ná de rally.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((it) => (
            <div key={it.id} className="card">
              <div className="mb-1 flex items-center gap-2">
                <span className="font-bold text-teal-dark">{it.teamName}</span>
                <span className="ml-auto chip">{it.typeLabel}</span>
              </div>
              <p className="mb-2 text-sm text-polder-grey">{it.prompt}</p>
              {it.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.photoUrl} alt="Bewijsfoto" className="mb-2 max-h-64 w-full rounded-soft object-cover" />
              ) : (
                <div className="mb-2 rounded-soft bg-paper p-3 text-center text-xs text-polder-grey">Geen foto bijgevoegd</div>
              )}
              <p className="mb-2 text-xs text-polder-grey">{it.createdAt}</p>
              <ReviewForm rallyId={rallyId} eventId={it.id} awarded={it.awarded} />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
