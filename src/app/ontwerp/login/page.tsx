import Link from "next/link";
import LoginForm from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-[440px] flex-col justify-center px-5 py-10">
      <div className="mb-4 text-center">
        <Link href="/" className="text-sm font-bold text-teal-dark">
          ← Startscherm
        </Link>
      </div>
      <div className="card p-7">
        <div className="text-center text-[40px]">🔐</div>
        <h1 className="text-center text-[20px] font-bold text-teal-dark">Beheer — alleen voor organisatoren</h1>
        <p className="mb-4 mt-1 text-center text-sm text-polder-grey">
          Het ontwerpersportaal is afgeschermd. Spelers kunnen hier niet bij.
        </p>
        <LoginForm next={next} />
        <div className="mt-4 rounded-soft border-[1.5px] border-dashed border-[#C9A227] bg-[#FFF9E8] p-2.5 text-[13px] text-[#6B5200]">
          🧪 Organisatoraccounts via Supabase Auth. Lukt inloggen niet en komt er geen bevestigingsmail? Zet dan
          <b> Confirm email</b> uit in Supabase (Authentication → Providers → Email), of vink
          <b> Auto Confirm User</b> aan bij het aanmaken van de gebruiker.
        </div>
      </div>
    </main>
  );
}
