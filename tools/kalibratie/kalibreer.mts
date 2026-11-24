// Kalibratie van de automatische screenshot-controle.
// Gebruik:
//   ANTHROPIC_API_KEY=... node --experimental-strip-types kalibratie/kalibreer.mts <map-met-screenshots> [opties]
// In de map staat een bestand "waarheid.csv" met per screenshot wat er écht op staat:
//   bestand,dag,stappen,bewerkt,app
//   iphone-01.png,2027-01-18,12431,nee,Gezondheid
//   nep-02.png,2027-01-18,18200,ja,Gezondheid        ← bewust bewerkt of met AI gemaakt
// Opties: --dubbel (twee leesrondes), --model <naam>, --zekerheid 0.9, --test (geen API: nagebootste lezer), --parallel 3
// Uitvoer: kalibratie-rapport.md en kalibratie-resultaten.csv in dezelfde map.
import fs from 'node:fs'; import path from 'node:path';
import { PROMPT, parseRead, review, type Ctx } from '../../supabase/functions/screenshot-review/review.ts';
import { inspect, assess } from '../../supabase/functions/screenshot-review/forensics.ts';

const args = process.argv.slice(2), dir = args.find(a => !a.startsWith('--'));
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k: string) => args.includes('--' + k);
if (!dir) { console.error('Geef een map op: node --experimental-strip-types kalibratie/kalibreer.mts <map>'); process.exit(2); }
const MODEL = opt('model', process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5'), MINC = Number(opt('zekerheid', '0.9')), PAR = Number(opt('parallel', '3')), DOUBLE = flag('dubbel'), TEST = flag('test');
if (!TEST && !process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY ontbreekt (of gebruik --test).'); process.exit(2); }

// ── waarheid.csv lezen (komma of puntkomma, kop verplicht)
const csv = fs.readFileSync(path.join(dir, 'waarheid.csv'), 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
const sep = csv[0].includes(';') ? ';' : ',', head = csv[0].split(sep).map(h => h.trim().toLowerCase());
for (const need of ['bestand', 'dag', 'stappen']) if (!head.includes(need)) { console.error(`Kolom "${need}" ontbreekt in waarheid.csv`); process.exit(2); }
type Truth = { bestand: string; dag: string; stappen: number; bewerkt: boolean; app: string };
const rows: Truth[] = csv.slice(1).filter(l => l.trim()).map(l => { const c = l.split(sep).map(x => x.trim()), g = (k: string) => c[head.indexOf(k)] ?? '';
  return { bestand: g('bestand'), dag: g('dag'), stappen: parseInt(g('stappen').replace(/[.\s]/g, ''), 10), bewerkt: /^(ja|j|yes|y|1|true)$/i.test(g('bewerkt')), app: g('app') || 'onbekend' }; });
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ── lezer: echt (Anthropic API) of nagebootst (--test)
async function readReal(bytes: Uint8Array, media: string): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, temperature: 0, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: media, data: Buffer.from(bytes).toString('base64') } }, { type: 'text', text: PROMPT }] }] }) });
    if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 2000 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error('API ' + r.status + ': ' + (await r.text()).slice(0, 200));
    const j: any = await r.json(); return (j.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
  }
  throw new Error('API bleef bezet');
}
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
function readFake(t: Truth): string {                // nagebootst: meestal goed, soms een leesfout, en ziet bewerking vaak (niet altijd)
  const err = rnd() < 0.08, miss = t.bewerkt && rnd() < 0.3;
  return JSON.stringify({ is_step_screen: true, steps: err ? t.stappen + 90 : t.stappen, date_iso: t.dag, relative_label: null, app_name: t.app, confidence: err ? 0.95 : 0.97, concerns: [], edit_suspected: t.bewerkt && !miss, edit_signs: t.bewerkt && !miss ? ['cijfers in ander lettertype'] : [] });
}
const mediaOf = (f: string) => /\.png$/i.test(f) ? 'image/png' : /\.webp$/i.test(f) ? 'image/webp' : 'image/jpeg';

type Res = Truth & { gelezen: number | null; datumGelezen: string | null; beslissing: string; reden: string; signalen: string; fout?: string };
async function one(t: Truth): Promise<Res> {
  const file = path.join(dir!, t.bestand);
  if (!fs.existsSync(file)) return { ...t, gelezen: null, datumGelezen: null, beslissing: 'overgeslagen', reden: '', signalen: '', fout: 'bestand niet gevonden' };
  const bytes = new Uint8Array(fs.readFileSync(file)), forensic = assess(inspect(bytes));
  try {
    const raw = TEST ? readFake(t) : await readReal(bytes, mediaOf(t.bestand)), raw2 = DOUBLE ? (TEST ? readFake(t) : await readReal(bytes, mediaOf(t.bestand))) : null;
    const p = parseRead(raw), p2 = raw2 ? parseRead(raw2) : null;
    const ctx: Ctx = { claimedDay: t.dag, uploadDay: addDays(t.dag, 1), maxPlausible: 60000, minConfidence: MINC, sampleRate: 0, sampleKey: t.bestand, history: [], duplicate: null, second: p2 && p2.ok ? p2.read : null, attempt: 1, authenticity: forensic };
    const v = review(p, ctx);
    return { ...t, gelezen: p.ok ? p.read.steps : null, datumGelezen: p.ok ? (p.read.date_iso ?? p.read.relative_label) : null, beslissing: v.action, reden: v.reason ?? '', signalen: forensic.signals.join(' | ') };
  } catch (e: any) { return { ...t, gelezen: null, datumGelezen: null, beslissing: 'fout', reden: '', signalen: forensic.signals.join(' | '), fout: String(e.message ?? e) }; }
}

const results: Res[] = []; let next = 0;
await Promise.all(Array.from({ length: Math.max(1, PAR) }, async () => { while (next < rows.length) { const i = next++; results[i] = await one(rows[i]); process.stdout.write(`\r${results.filter(Boolean).length}/${rows.length} gecontroleerd`); } }));
console.log('');

// ── cijfers
const done = results.filter(r => r.beslissing !== 'overgeslagen' && r.beslissing !== 'fout');
const pctf = (a: number, b: number) => b ? (a / b * 100).toFixed(1).replace('.', ',') + '%' : '–';
const exact = done.filter(r => r.gelezen === r.stappen).length, dateOk = done.filter(r => r.datumGelezen === r.dag || (r.datumGelezen === 'yesterday')).length;
const appr = done.filter(r => r.beslissing === 'approve'), rev = done.filter(r => r.beslissing === 'review'), ret = done.filter(r => r.beslissing === 'retry');
const wrongAppr = appr.filter(r => r.gelezen !== r.stappen || r.bewerkt);
const edited = done.filter(r => r.bewerkt), caught = edited.filter(r => r.beslissing !== 'approve'), clean = done.filter(r => !r.bewerkt), falseAuth = clean.filter(r => /^Echtheid/.test(r.reden));
const apps = [...new Set(done.map(r => r.app))].sort();
const verdict = wrongAppr.length === 0 ? (edited.length && caught.length / edited.length < 0.8 ? 'Let op: geen foute goedkeuringen, maar te weinig bewerkte screenshots gevangen.' : 'Geen enkele foute goedkeuring. Klaar om (met steekproef) in gebruik te nemen.') : `NIET klaar: ${wrongAppr.length} screenshot(s) werden ten onrechte goedgekeurd. ${DOUBLE ? 'Verhoog de zekerheidsdrempel (--zekerheid 0.95) en bekijk de bestanden hieronder' : 'Zet --dubbel aan of verhoog de zekerheidsdrempel'}, en meet opnieuw.`;
const L: string[] = [];
L.push(`# Kalibratie screenshot-controle`, '', `${TEST ? '**TESTMODUS: nagebootste lezer, geen echte meting.**  ' : ''}Model: \`${MODEL}\` · zekerheidsdrempel ${MINC} · ${DOUBLE ? 'twee leesrondes' : 'één leesronde'} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, '',
  `## Oordeel`, '', `**${verdict}**`, '',
  `## Lezen`, '', `| | |`, `|---|---|`, `| Screenshots gemeten | ${done.length}${results.length - done.length ? ` (${results.length - done.length} overgeslagen of mislukt)` : ''} |`, `| Getal exact goed gelezen | ${pctf(exact, done.length)} |`, `| Datum goed gelezen | ${pctf(dateOk, done.length)} |`, '',
  `## Beslissingen`, '', `| | |`, `|---|---|`, `| Automatisch goedgekeurd | ${pctf(appr.length, done.length)} (${appr.length}) |`, `| Naar een beheerder | ${pctf(rev.length, done.length)} (${rev.length}) |`, `| Deelnemer moet opnieuw uploaden | ${pctf(ret.length, done.length)} (${ret.length}) |`,
  `| **Ten onrechte goedgekeurd (moet 0 zijn)** | **${wrongAppr.length}** |`, '',
  `## Echtheid (bewerkt of met AI gemaakt)`, '', `| | |`, `|---|---|`, `| Bewerkte screenshots in de set | ${edited.length} |`, `| Daarvan tegengehouden | ${pctf(caught.length, edited.length)} (${caught.length}) |`, `| Vals alarm op eerlijke screenshots | ${pctf(falseAuth.length, clean.length)} (${falseAuth.length}) |`, '',
  `## Per app`, '', `| App | Aantal | Getal goed | Automatisch goedgekeurd |`, `|---|---|---|---|`, ...apps.map(a => { const x = done.filter(r => r.app === a); return `| ${a} | ${x.length} | ${pctf(x.filter(r => r.gelezen === r.stappen).length, x.length)} | ${pctf(x.filter(r => r.beslissing === 'approve').length, x.length)} |`; }), '');
if (wrongAppr.length) L.push(`## Ten onrechte goedgekeurd`, '', ...wrongAppr.map(r => `- \`${r.bestand}\`: verwacht ${r.stappen}, gelezen ${r.gelezen}${r.bewerkt ? ', bewerkt' : ''}`), '');
const missed = edited.filter(r => r.beslissing === 'approve'); if (missed.length) L.push(`## Bewerkt maar niet tegengehouden`, '', ...missed.map(r => `- \`${r.bestand}\``), '');
const errs = results.filter(r => r.fout); if (errs.length) L.push(`## Niet gemeten`, '', ...errs.map(r => `- \`${r.bestand}\`: ${r.fout}`), '');
fs.writeFileSync(path.join(dir, 'kalibratie-rapport.md'), L.join('\n'));
const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
fs.writeFileSync(path.join(dir, 'kalibratie-resultaten.csv'), ['bestand;app;dag;verwacht;gelezen;datum_gelezen;bewerkt;beslissing;reden;signalen;fout', ...results.map(r => [r.bestand, r.app, r.dag, r.stappen, r.gelezen, r.datumGelezen, r.bewerkt ? 'ja' : 'nee', r.beslissing, r.reden, r.signalen, r.fout].map(q).join(';'))].join('\n'));
console.log(L.slice(0, 14).join('\n')); console.log(`\nRapport: ${path.join(dir, 'kalibratie-rapport.md')}`);
process.exit(wrongAppr.length ? 1 : 0);
