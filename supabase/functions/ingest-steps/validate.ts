// Pure beslislogica voor binnenkomende dagtotalen. Geen netwerk, geen database: daardoor goed te testen.
// De app (of een Garmin/Fitbit-koppeling) levert alleen dagtotalen; HIER wordt bepaald of een dag meetelt.

export type Source = 'healthkit' | 'health_connect' | 'garmin' | 'fitbit' | 'withings' | 'polar' | 'screenshot';
export interface Incoming { day: string; steps: number; source_kind: Source; is_manual?: boolean }
export interface Existing { status: 'ok' | 'pending' | 'rejected'; source_kind: string; reviewed_by?: string | null; steps: number }
export interface Ctx {
  today: string;            // YYYY-MM-DD in de tijdzone van de challenge
  start: string; days: number; maxPlausible: number; backfillDays: number;
  participantSource: Source; // de bron waarmee deze deelnemer is gekoppeld
  existing?: Existing | null;
}
export type Decision =
  | { accept: false; error: string }
  | { accept: true; status: 'ok' | 'pending'; reason: string | null; steps: number; day: string };

const AUTO: Source[] = ['healthkit', 'health_connect', 'garmin', 'fitbit', 'withings', 'polar'];
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function decide(e: Incoming, c: Ctx): Decision {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.day)) return { accept: false, error: 'Ongeldige datum' };
  if (!Number.isInteger(e.steps) || e.steps < 0 || e.steps > 200000) return { accept: false, error: 'Ongeldig aantal stappen' };
  const end = addDays(c.start, c.days - 1);
  if (e.day < c.start || e.day > end) return { accept: false, error: 'Datum valt buiten de challenge' };
  if (e.day > c.today) return { accept: false, error: 'Datum ligt in de toekomst' };
  if (e.day < addDays(c.today, -c.backfillDays)) return { accept: false, error: 'Te lang geleden: neem contact op met de organisatie' };
  if (e.source_kind === 'screenshot') return { accept: false, error: 'Screenshots lopen via de uploadroute' };
  if (e.source_kind !== c.participantSource) return { accept: false, error: 'Bron komt niet overeen met je gekoppelde bron' };
  if (!AUTO.includes(e.source_kind)) return { accept: false, error: 'Onbekende bron' };
  // Wat door een beheerder is goedgekeurd of afgekeurd, overschrijft de app nooit meer.
  if (c.existing && c.existing.reviewed_by) return { accept: false, error: 'Deze dag is al door een beheerder beoordeeld' };

  // Handmatig ingevoerde stappen en onwaarschijnlijke aantallen gaan naar de beheerder in plaats van direct te tellen.
  if (e.is_manual) return { accept: true, day: e.day, steps: e.steps, status: 'pending', reason: 'Handmatig ingevoerd in de gezondheidsapp' };
  if (e.steps > c.maxPlausible) return { accept: true, day: e.day, steps: e.steps, status: 'pending', reason: `Ongebruikelijk hoog aantal (${e.steps})` };
  // Plotselinge sprong t.o.v. een eerder gesynchroniseerde waarde voor dezelfde dag (bijv. later bijgeschreven data) wordt wel geaccepteerd,
  // maar een daling na afloop van de dag niet stilletjes: dat is verdacht.
  if (c.existing && c.existing.status === 'ok' && e.steps < c.existing.steps && e.day < c.today) return { accept: true, day: e.day, steps: e.steps, status: 'pending', reason: `Aantal daalde van ${c.existing.steps} naar ${e.steps}` };
  return { accept: true, day: e.day, steps: e.steps, status: 'ok', reason: null };
}
