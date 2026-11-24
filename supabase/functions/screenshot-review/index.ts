// Supabase Edge Function (Deno). NIET getest tegen echte Supabase of de echte Anthropic API: er was hier geen sleutel/omgeving.
// De beslislogica (review.ts) en de database zijn wel getest. Zie README.
//
// Flow: app uploadt de screenshot naar Storage (bucket "screenshots", pad "<participant_id>/<dag>-<n>.jpg"),
//       roept deze functie aan met { day, path }, en krijgt direct een uitkomst terug:
//       approve (stappen zijn toegevoegd), review (een beheerder kijkt mee) of retry (upload opnieuw, met reden).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PROMPT, parseRead, review, type Ctx } from './review.ts';
import { inspect, assess } from './forensics.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5-5';     // te kiezen na kalibratie op echte screenshots
const DOUBLE_READ = Deno.env.get('DOUBLE_READ') === '1';                 // tweede, onafhankelijke leesronde (kost 2×, vangt hallucinaties af)
const SAMPLE_RATE = Number(Deno.env.get('SAMPLE_RATE') ?? '0.05');       // aandeel goedgekeurde screenshots dat toch langs een mens gaat
const MIN_CONFIDENCE = Number(Deno.env.get('MIN_CONFIDENCE') ?? '0.9');
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

async function readImage(bytes: Uint8Array, mediaType: string): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, temperature: 0, messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64(bytes) } }, { type: 'text', text: PROMPT } ] }] }),
  });
  if (!r.ok) throw new Error('Leesdienst gaf ' + r.status);
  const j = await r.json(); return (j.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Alleen POST' }, 405);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: u } = await admin.auth.getUser((req.headers.get('Authorization') ?? '').replace('Bearer ', ''));
  if (!u?.user) return json({ error: 'Niet ingelogd' }, 401);
  const { data: p } = await admin.from('participants').select('id').eq('auth_user_id', u.user.id).single();
  if (!p) return json({ error: 'Geen deelnemer' }, 403);
  let body: { day?: string; path?: string }; try { body = await req.json(); } catch { return json({ error: 'Ongeldige JSON' }, 400); }
  const day = body.day ?? '', path = body.path ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !path.startsWith(p.id + '/')) return json({ error: 'Ongeldig verzoek' }, 400);   // alleen eigen bestanden
  const { data: ch } = await admin.from('challenge').select('*').single(); const { data: today } = await admin.rpc('today_nl');
  const end = new Date(ch.start_date + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + ch.days - 1);
  const back = new Date(today + 'T00:00:00Z'); back.setUTCDate(back.getUTCDate() - ch.backfill_days);
  if (day < ch.start_date || day > end.toISOString().slice(0, 10) || day > today || day < back.toISOString().slice(0, 10)) return json({ verdict: 'retry', reason: 'Deze dag kun je niet (meer) indienen' });
  const { data: existing } = await admin.from('daily_steps').select('reviewed_by, status').eq('participant_id', p.id).eq('day', day).maybeSingle();
  // Na afkeuren mag de deelnemer een nieuwe screenshot sturen; een goedgekeurde dag blijft staan.
  if (existing?.reviewed_by && existing.status !== 'rejected') return json({ verdict: 'review', reason: 'Deze dag is al door een beheerder beoordeeld' });

  const dl = await admin.storage.from('screenshots').download(path);
  if (dl.error || !dl.data) return json({ error: 'Bestand niet gevonden' }, 404);
  const bytes = new Uint8Array(await dl.data.arrayBuffer()), type = dl.data.type;
  if (bytes.length > 5_000_000 || !['image/jpeg', 'image/png', 'image/webp'].includes(type)) return json({ verdict: 'retry', reason: 'Gebruik een JPG, PNG of WebP van maximaal 5 MB' });
  const sha = hex(await crypto.subtle.digest('SHA-256', bytes));
  // Echtheid op bestandsniveau. Werkt alleen als de app het ORIGINELE bestand uploadt (niet verkleinen of opnieuw comprimeren).
  const forensic = assess(inspect(bytes));

  const { count } = await admin.from('screenshot_reads').select('id', { count: 'exact', head: true }).eq('participant_id', p.id).eq('day', day);
  const { data: hist } = await admin.from('daily_steps').select('steps').eq('participant_id', p.id).eq('status', 'ok').neq('day', day);
  let raw1: string, raw2: string | null = null;
  try { raw1 = await readImage(bytes, type); if (DOUBLE_READ) raw2 = await readImage(bytes, type); }
  catch { await admin.from('screenshot_reads').insert({ participant_id: p.id, day, attempt: (count ?? 0) + 1, sha256: sha, verdict: 'review', reason: 'Leesdienst niet beschikbaar' });
    await admin.from('daily_steps').upsert({ participant_id: p.id, day, steps: 0, source_kind: 'screenshot', is_manual: false, status: 'pending', reason: 'Leesdienst niet beschikbaar: handmatig controleren', screenshot_path: path });
    return json({ verdict: 'review', reason: 'Je screenshot is ontvangen; een beheerder controleert hem.' }); }       // een storing mag nooit een deelnemer benadelen

  const parsed = parseRead(raw1), second = raw2 ? parseRead(raw2) : null;
  const { data: dup } = parsed.ok ? await admin.rpc('find_duplicate', { p_participant: p.id, p_day: day, p_sha: sha, p_steps: parsed.read.steps ?? -1, p_app: parsed.read.app_name }) : { data: null };
  const ctx: Ctx = { claimedDay: day, uploadDay: today, maxPlausible: ch.max_plausible, minConfidence: MIN_CONFIDENCE, sampleRate: SAMPLE_RATE, sampleKey: `${p.id}:${day}`,
    history: (hist ?? []).map((h: any) => h.steps), duplicate: dup, authenticity: forensic, second: second && second.ok ? second.read : null, attempt: (count ?? 0) + 1 };
  const verdict = second && !second.ok ? { action: 'review' as const, steps: parsed.ok ? parsed.read.steps : null, reason: 'Tweede leesronde mislukt' } : review(parsed, ctx);

  await admin.from('screenshot_reads').insert({ participant_id: p.id, day, attempt: ctx.attempt, sha256: sha, model_read: parsed.ok ? parsed.read : null, auth_signals: forensic.signals, verdict: verdict.action, steps: 'steps' in verdict ? verdict.steps : null, reason: verdict.reason });
  if (verdict.action === 'approve')
    await admin.from('daily_steps').upsert({ participant_id: p.id, day, steps: verdict.steps, source_kind: 'screenshot', is_manual: false, status: 'ok', reason: null, screenshot_path: path, synced_at: new Date().toISOString() });
  else if (verdict.action === 'review')
    await admin.from('daily_steps').upsert({ participant_id: p.id, day, steps: verdict.steps ?? 0, source_kind: 'screenshot', is_manual: false, status: 'pending', reason: verdict.reason, screenshot_path: path, synced_at: new Date().toISOString() });
  return json({ verdict: verdict.action, steps: 'steps' in verdict ? verdict.steps : null, reason: verdict.reason });
});
