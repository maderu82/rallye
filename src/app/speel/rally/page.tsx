import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { TEAM_COOKIE } from "@/lib/play/constants";
import { getPlayState, getLeaderboard } from "@/lib/play/data";
import PlayClient from "./PlayClient";

export const dynamic = "force-dynamic";

export default async function RallyPlayPage({
  searchParams,
}: {
  searchParams: Promise<{ test?: string }>;
}) {
  const token = (await cookies()).get(TEAM_COOKIE)?.value;
  if (!token) redirect("/speel");

  const state = await getPlayState(token);
  if (!state) redirect("/speel");

  const leaderboard = await getLeaderboard(state.rally.id, state.team.id);
  const testMode = (await searchParams).test === "1";

  return <PlayClient state={state} leaderboard={leaderboard} testMode={testMode} />;
}
