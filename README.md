# Polderpuzzel rallye

Doe-het-zelf platform voor puzzelrally's (auto, fiets of te voet), gespeeld door
teams die één telefoon delen — met een ontwerpersportaal waarin organisatoren hun
eigen rally bouwen. De echte-productversie van de prototype-specificatie **v0.6**.

Gebouwd met **Next.js (App Router) + TypeScript + Tailwind** op **Vercel**, met
**Supabase** voor Postgres, Auth, (later) Storage en Realtime.

---

## Wat er in deze eerste versie zit

**Deelnemersapp** (`/speel`) — geen account
- Meedoen met een teamcode + teamnaam (sessie op de gedeelde telefoon via cookie).
- Waypoint-voor-waypoint spelen: navigatie per etappe (kompas / straatboek /
  bolletje-pijltje / kaart), gps-ontgrendeling (echte geolocatie + duidelijk
  gelabelde demo-knop), en de opdracht per punt.
- **Alle 12 bouwstenen** worden ondersteund; de demo-rally gebruikt meerkeuze,
  fotozoek, snelheidsproef, QR-zoek, codekraker en vrij spelmoment.
- Echte puntentelling en live klassement. Antwoorden worden **server-side**
  gecontroleerd — antwoordsleutels bereiken de browser nooit.
- Codekraker met de tweetraps-hulp uit §3.3 (eerst hint, daarna cijfers kopen à
  −10; gekochte cijfers tellen niet als hint).
- Badges, eindscherm met statistieken en eindklassement.

**Ontwerpersportaal** (`/ontwerp`) — met login (Supabase Auth)
- Eigen rally's aanmaken, publiceren en verwijderen.
- Editor met drie panelen (punten & trajecten · kaart · instellingen):
  - Punten toevoegen op de kaart (gps wordt automatisch ingevuld), naam/gps
    bewerken, verwijderen (met hernummering), volgorde met ▲/▼ (start & finish
    vast).
  - Opdracht per punt aan/uit + type (alle 12), punten, hint-instelling, gps.
  - Trajecten als eersteklas objecten: navigatiewijze met bijpassende
    instructievelden en optionele onderwegvraag.
- **Teams volgen**: live kaart met teamposities + voortgang per team (alleen
  meekijken; correcties ná de rally).

- **Realtime klassement & tracking** via Supabase Realtime: de deelnemer ziet
  het klassement live meebewegen; de organisator ziet teamposities/scores direct
  updaten (`team_scores`-tabel, bijgehouden met triggers, secret-vrij, publiek
  leesbaar voor gepubliceerde rally's).
- **Foto-bewijs**: foto-zoek en vrij-spel foto's uploaden naar een privé
  Supabase Storage-bucket (client-side verkleind), met een **nakijkscherm**
  (`/ontwerp/[id]/review`) waar de organisator foto's bekijkt (signed URLs) en de
  punten ná de rally corrigeert.

**Beveiliging**
- Row-Level Security: een organisator ziet/bewerkt uitsluitend zijn eigen rally's.
- Al het deelnemersverkeer en alle beoordeling loopt via de Next.js-server met de
  service-role sleutel, zodat scores niet te manipuleren zijn.
- `team_events` (met antwoord-inzendingen) is nooit direct leesbaar voor
  deelnemers; het klassement leest een aparte, secret-vrije `team_scores`-tabel.

### Nog niet in deze iteratie (logische vervolgstappen)
- E-mailbevestiging / uitgebreider organisatorbeheer.
- Onderwegvraag als speelbare interactie (nu getoond als etappe-notitie).

---

## Lokaal draaien

### 1. Vereisten
- Node.js 20+
- Een Supabase-project (gratis tier volstaat) — <https://supabase.com>

### 2. Installeren
```bash
npm install
cp .env.example .env.local
```

Vul `.env.local` met de waarden uit **Supabase → Project Settings → API**:
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...        # server-only, nooit in de browser
```

### 3. Database opzetten
Draai de migraties in `supabase/migrations` op je Supabase-project. Twee opties:

**A. Supabase CLI** (aanbevolen)
```bash
npm i -g supabase
supabase link --project-ref <jouw-project-ref>
supabase db push
```

**B. SQL Editor**
Open de Supabase SQL Editor en plak de inhoud van, op volgorde:
1. `supabase/migrations/0001_init.sql` (schema + RLS)
2. `supabase/migrations/0002_demo_seed.sql` (de demo-rally "Polderpuzzel rallye",
   teamcode **RLY-7H2K** — optioneel; laat weg in productie)
3. `supabase/migrations/0003_realtime_scores.sql` (klassement-tabel + Realtime)
4. `supabase/migrations/0004_storage.sql` (privé bucket voor bewijsfoto's)

### 4. Organisatoraccount
Maak in **Supabase → Authentication → Users** een gebruiker aan, of registreer via
`/ontwerp/login`. Zet desgewenst e-mailbevestiging uit onder
**Authentication → Providers → Email** voor een soepele demo.

### 5. Starten
```bash
npm run dev
```
Open <http://localhost:3000>. Speel de demo via **Speel als team** (code
`RLY-7H2K`), of log in bij **Ontwerp een rallye**.

---

## Deployen op Vercel
1. Push deze repo naar GitHub en importeer hem in Vercel.
2. Zet dezelfde drie environment variables in **Vercel → Project → Settings →
   Environment Variables** (voor Production én Preview).
3. Deploy. Vercel detecteert Next.js automatisch; geen extra configuratie nodig.
4. Voeg in **Supabase → Authentication → URL Configuration** je Vercel-URL toe als
   Site URL / Redirect URL.

---

## Projectstructuur
```
src/
  app/
    page.tsx                     # startscherm (twee ingangen)
    speel/                       # deelnemersapp (join + spelen)
      rally/PlayClient.tsx       # het spel-verloop
    ontwerp/                     # ontwerpersportaal (auth-gated)
      login/                     # organisator-login
      [rallyId]/EditorClient.tsx # de rally-editor + live view
  lib/
    blocks.ts                    # de 12 bouwstenen + navigatiemodi
    grading.ts                   # server-side antwoordbeoordeling (§3.3/§4)
    supabase/                    # browser / server / admin clients + middleware
    play/                        # deelnemers: data-loader + scored server actions
    designer/                    # ontwerpers: CRUD server actions
    auth/                        # login/logout/registratie
supabase/migrations/             # schema, RLS en demo-seed
```

De prototype-specificatie staat los van de code; deze app is de build-mode
realisatie ervan.
