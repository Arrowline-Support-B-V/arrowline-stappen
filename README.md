# Arrowline Stappenchallenge · januari 2027

* `public/` – de PWA (wat Vercel online zet). **Nu nog het prototype met demodata**: zie "Wat er daarna nog moet".
* `supabase/` – database (puntentelling, beheer, logboek), screenshot-controle en e-mailsjabloon.
* `tools/` – tests (`npm test`) en kalibratie (`npm run kalibreer -- <map>`).

---

## Online zetten: GitHub → Vercel → Supabase → Resend → domein

### 1. GitHub
1. Maak een **privé** repository, bijvoorbeeld `arrowline/stappenchallenge`.
2. Zet deze map erin (`git init`, `git add .`, `git commit -m "Eerste versie"`, `git push`).
3. Controleer dat er **geen `.env`** met sleutels in staat (`.gitignore` regelt dat).

### 2. Vercel
1. Vercel → *Add New Project* → kies de GitHub-repository.
2. *Framework Preset*: **Other**. Build command: leeg. Output directory: **`public`** (staat ook in `vercel.json`).
3. Deploy. Je krijgt een adres als `stappenchallenge.vercel.app`. Elke `git push` zet automatisch een nieuwe versie online.
4. `vercel.json` zorgt dat `sw.js`, `index.html` en het manifest niet worden gecachet (anders komen updates niet door) en zet een paar veiligheidsheaders.

### 3. Supabase
1. Maak een project in regio **Frankfurt (eu-central-1)**.
2. Installeer de Supabase CLI en koppel: `supabase link --project-ref <ref>`.
3. Database: `supabase db push` (draait `0001` t/m `0005`).
4. Geheimen voor de screenshot-controle: `supabase secrets set ANTHROPIC_API_KEY=... DOUBLE_READ=1 SAMPLE_RATE=0.2 MIN_CONFIDENCE=0.9`.
5. Functie uitrollen: `supabase functions deploy screenshot-review` (`ingest-steps` is niet nodig: er wordt niet gekoppeld).
6. *Authentication → URL Configuration*: Site URL `https://stappenmet.arrowline.nl`, en voeg ook het `vercel.app`-adres toe als redirect-URL.
7. *Authentication → Providers → Email*: zet "magic link" aan. Beperk aanmelden tot collega's: alleen uitnodigen, of alleen `@arrowline.nl` toestaan.
8. Beheerders toevoegen: `insert into admins(user_id) values ('<auth user id>');`

### 4. Resend (e-mail voor de inloglinks)
1. Resend → *Domains* → voeg **`arrowline.nl`** (of een subdomein zoals `mail.arrowline.nl`) toe.
2. Zet de DNS-records die Resend toont (SPF/DKIM) bij de DNS van arrowline.nl. **Hiervoor heb je IT of de beheerder van het domein nodig.**
3. Maak een API-key.
4. Supabase → *Authentication → Emails → SMTP Settings*: host `smtp.resend.com`, poort `465`, gebruiker `resend`, wachtwoord = de Resend API-key, afzender bijvoorbeeld `stappen@arrowline.nl`, naam "Arrowline Stappenchallenge".
5. Plak `supabase/templates/magic_link.html` als sjabloon voor de inlogmail (Nederlands, in de huisstijl).

### 5. Domein `stappenmet.arrowline.nl`
1. Vercel → project → *Settings → Domains* → voeg `stappenmet.arrowline.nl` toe.
2. Vercel toont een **CNAME**-record. Laat IT dat bij de DNS van arrowline.nl zetten (meestal `stappenmet` → `cname.vercel-dns.com`, maar neem over wat Vercel toont).
3. Vercel regelt het HTTPS-certificaat zelf. Pas daarna is de PWA installeerbaar.

---

## Let op: gratis abonnementen

Controleer de actuele voorwaarden zelf; die veranderen.

| Dienst | Waarop letten |
|---|---|
| **Vercel Hobby (gratis)** | Bedoeld voor **persoonlijk, niet-commercieel** gebruik. Een bedrijfsapp valt daar waarschijnlijk buiten. Kies Vercel Pro, of een host die gratis zakelijk gebruik toestaat (bijvoorbeeld Cloudflare Pages: de PWA is gewoon een map met statische bestanden). |
| **Supabase Free** | **Opslag is beperkt** (rond 1 GB). Screenshots zijn 1 tot 2 MB: 60 deelnemers × 31 dagen is al zo'n 2 tot 3 GB. Verwijder daarom goedgekeurde screenshots na een paar dagen, of neem voor januari het Pro-abonnement. Gratis projecten worden **gepauzeerd na een week zonder gebruik** (let op in december), en de back-upmogelijkheden zijn beperkt. |
| **Resend Free** | Er is een **daglimiet** op het aantal e-mails. Op de eerste dag loggen alle deelnemers tegelijk in. Spreid de uitnodigingen, en zorg dat mensen ingelogd blijven. |
| **Anthropic API** | **Niet gratis**: je betaalt per gelezen screenshot (en dubbel bij twee leesrondes). Klein bedrag per screenshot, maar zet een budgetlimiet in het account. |

---

## Wat er daarna nog moet (de app koppelen)

`public/index.html` draait nu nog op demodata. Voordat echte deelnemers kunnen beginnen:

1. **Inloggen** met Supabase Auth (inloglink per e-mail via Resend).
2. **Gegevens uit de database** in plaats van demodata: `public_team_scores()`, `public_person_scores()`, `public_team_day_status()`, eigen `daily_steps`, `my_warnings()`.
3. **Uploaden:** het **originele bestand** naar Storage (`screenshots/<participant_id>/<dag>-<n>.png`, niet verkleinen), daarna `screenshot-review` aanroepen en de uitkomst tonen.
4. **Beheerpagina** via `admin_queue()`, `admin_approve()`, `admin_reject()`, `admin_revert()`. Alleen zichtbaar voor beheerders.
5. **Demo-onderdelen verwijderen:** demo-schaal, "wat leest het systeem?", de link "Beheer (demo)", de vaste datum 19 januari, en de prototype-teksten.
6. **Opruimen:** een dagelijkse taak die goedgekeurde screenshots na bijvoorbeeld 7 dagen verwijdert (opslag én privacy), en na de challenge alles.

Tests: `npm install` en `npm test`.
