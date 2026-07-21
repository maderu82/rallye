import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-[960px] px-5 py-12">
      <div className="mb-9 text-center">
        <span className="inline-block text-[56px]">🧭</span>
        <h1 className="text-[40px] font-bold text-teal-dark">Polderpuzzel rallye</h1>
        <p className="mt-2 text-[17px] text-polder-grey">
          Doe-het-zelf puzzelrally&apos;s per auto, fiets of te voet — één telefoon per team.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Link
          href="/speel"
          className="group rounded-card border-2 border-transparent bg-white p-8 shadow-card transition hover:-translate-y-1 hover:border-teal"
        >
          <span className="text-[40px]">📱</span>
          <h2 className="mb-1.5 mt-3 text-[22px] font-bold text-teal-dark">Speel als team</h2>
          <p className="text-[15px] leading-relaxed text-polder-grey">
            Stap in de deelnemersapp en speel een rally van start tot finish: puzzels, kompas,
            QR-bordjes en het live klassement. Geen account nodig — join met je teamcode.
          </p>
          <span className="mt-3.5 inline-block rounded-full bg-teal-light px-2.5 py-1.5 text-xs font-bold text-teal-dark">
            Deelnemersapp · mobiel
          </span>
        </Link>

        <Link
          href="/ontwerp"
          className="group rounded-card border-2 border-transparent bg-white p-8 shadow-card transition hover:-translate-y-1 hover:border-teal"
        >
          <span className="text-[40px]">🗺️</span>
          <h2 className="mb-1.5 mt-3 text-[22px] font-bold text-teal-dark">Ontwerp een rallye</h2>
          <p className="text-[15px] leading-relaxed text-polder-grey">
            Bouw je eigen rally in het ontwerpersportaal: waypoints op de kaart, etappes met
            navigatiemodus en een instellingenpaneel per opdracht. Alleen voor organisatoren.
          </p>
          <span className="mt-3.5 inline-block rounded-full bg-teal-light px-2.5 py-1.5 text-xs font-bold text-teal-dark">
            Ontwerpersportaal · desktop · 🔐 met login
          </span>
        </Link>
      </div>
    </main>
  );
}
