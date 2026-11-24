// Supabase Edge Function (Deno). NIET getest tegen een echte Supabase-omgeving: zie README.
// POST /functions/v1/ingest-steps   Authorization: Bearer <JWT van de ingelogde deelnemer>
// Body: { "days": [ { "day": "2027-01-04", "steps": 12431, "source_kind": "healthkit", "is_manual": false }, ... ] }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decide, type Incoming, type Source } from './validate.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Alleen POST' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const admin = createClient(url, service);
  const { data: u, error: ue } = await admin.auth.getUser(jwt);                       // wie belt er?
  if (ue || !u?.user) return json({ error: 'Niet ingelogd' }, 401);
  const { data: p } = await admin.from('participants').select('id, source').eq('auth_user_id', u.user.id).single();
  if (!p) return json({ error: 'Geen deelnemer' }, 403);
  const { data: ch } = await admin.from('challenge').select('*').single();
  const { data: today } = await admin.rpc('today_nl');
  let body: { days?: Incoming[] }; try { body = await req.json(); } catch { return json({ error: 'Ongeldige JSON' }, 400); }
  const items = (body.days ?? []).slice(0, 10);                                       // nooit meer dan 10 dagen per verzoek
  const results = [];
  for (const it of items) {
    const { data: existing } = await admin.from('daily_steps').select('status, source_kind, reviewed_by, steps').eq('participant_id', p.id).eq('day', it.day).maybeSingle();
    const d = decide(it, { today, start: ch.start_date, days: ch.days, maxPlausible: ch.max_plausible, backfillDays: ch.backfill_days, participantSource: p.source as Source, existing });
    if (!d.accept) { results.push({ day: it.day, accepted: false, error: d.error }); continue; }
    const { error } = await admin.from('daily_steps').upsert({ participant_id: p.id, day: d.day, steps: d.steps, source_kind: it.source_kind, is_manual: !!it.is_manual, status: d.status, reason: d.reason, synced_at: new Date().toISOString() });
    results.push({ day: it.day, accepted: !error, status: d.status, reason: d.reason, error: error?.message });
  }
  return json({ results });
});
