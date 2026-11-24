// Echtheidscontrole op bestandsniveau. Pure functies op de ruwe bytes: geen netwerk, volledig testbaar.
// BELANGRIJK: dit is een signaal, geen bewijs. Metadata kan ontbreken (bijv. na WhatsApp) of worden weggehaald.
// Daarom leidt een verdacht signaal alleen tot controle door een mens, nooit tot automatisch afkeuren.

export interface Inspect {
  format: 'png' | 'jpeg' | 'webp' | 'other';
  width: number | null; height: number | null;
  tools: string[];          // bewerkings- of AI-programma's die in de metadata worden genoemd
  hasC2PA: boolean;         // Content Credentials aanwezig
  c2paAI: boolean;          // Content Credentials zeggen: (deels) gemaakt met AI
}
export interface Assessment { risk: 'none' | 'low' | 'high'; signals: string[] }

const TOOLS: [RegExp, string][] = [
  [/photoshop/i, 'Photoshop'], [/lightroom/i, 'Lightroom'], [/\bgimp\b/i, 'GIMP'], [/canva/i, 'Canva'], [/snapseed/i, 'Snapseed'],
  [/picsart/i, 'PicsArt'], [/pixelmator/i, 'Pixelmator'], [/affinity/i, 'Affinity'], [/paint\.net/i, 'Paint.NET'], [/photopea/i, 'Photopea'],
  [/fotor/i, 'Fotor'], [/midjourney/i, 'Midjourney'], [/dall[-·e ]*e/i, 'DALL·E'], [/stable.?diffusion/i, 'Stable Diffusion'],
  [/firefly/i, 'Adobe Firefly'], [/openai/i, 'OpenAI'], [/imagen/i, 'Imagen'],
];
const AI_SOURCE = /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|algorithmicMedia/;

const ascii = (b: Uint8Array, from = 0, to = b.length) => { let s = ''; for (let i = from; i < to; i++) { const c = b[i]; s += c >= 32 && c < 127 ? String.fromCharCode(c) : ' '; } return s; };
const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];

export function inspect(b: Uint8Array): Inspect {
  const out: Inspect = { format: 'other', width: null, height: null, tools: [], hasC2PA: false, c2paAI: false };
  let meta = '';                                                    // alleen metadata-tekst, nooit pixeldata
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    out.format = 'png'; let i = 8;
    while (i + 8 <= b.length) {
      const len = u32(b, i), type = ascii(b, i + 4, i + 8), d0 = i + 8, d1 = Math.min(b.length, d0 + len);
      if (type === 'IHDR' && len >= 8) { out.width = u32(b, d0); out.height = u32(b, d0 + 4); }
      else if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt' || type === 'eXIf') meta += ' ' + ascii(b, d0, d1);
      else if (type === 'caBX') { out.hasC2PA = true; meta += ' ' + ascii(b, d0, d1); }
      if (type === 'IEND') break; i = d1 + 4;
    }
  } else if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    out.format = 'jpeg'; let i = 2;
    while (i + 4 <= b.length && b[i] === 0xff) {
      const m = b[i + 1]; if (m === 0xd9 || m === 0xda) break;                // einde of begin van de beelddata
      const len = u16(b, i + 2), d0 = i + 4, d1 = Math.min(b.length, i + 2 + len);
      if (m >= 0xe0 && m <= 0xef) { meta += ' ' + ascii(b, d0, d1); if (m === 0xeb && /jumb|c2pa/.test(ascii(b, d0, d1))) out.hasC2PA = true; }
      if ((m === 0xc0 || m === 0xc1 || m === 0xc2) && len >= 7) { out.height = u16(b, d0 + 1); out.width = u16(b, d0 + 3); }
      i = d1;
    }
  } else if (b.length > 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') {
    out.format = 'webp'; let i = 12;
    while (i + 8 <= b.length) { const type = ascii(b, i, i + 4), len = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24), d0 = i + 8, d1 = Math.min(b.length, d0 + len);
      if (type === 'XMP ' || type === 'EXIF') meta += ' ' + ascii(b, d0, d1);
      if (type === 'VP8X' && len >= 10) { out.width = 1 + (b[d0 + 4] | (b[d0 + 5] << 8) | (b[d0 + 6] << 16)); out.height = 1 + (b[d0 + 7] | (b[d0 + 8] << 8) | (b[d0 + 9] << 16)); }
      i = d1 + (len & 1); }
  }
  for (const [re, name] of TOOLS) if (re.test(meta) && !out.tools.includes(name)) out.tools.push(name);
  if (AI_SOURCE.test(meta)) { out.c2paAI = true; out.hasC2PA = true; }   // IPTC 'digital source type' voor AI-beelden
  return out;
}

export function assess(f: Inspect): Assessment {
  const high: string[] = [], low: string[] = [];
  if (f.c2paAI) high.push('Content Credentials: (deels) gemaakt met AI');
  if (f.tools.length) high.push('Bewerkt of gemaakt met ' + f.tools.join(', '));
  if (f.hasC2PA && !f.c2paAI) low.push('Bevat bewerkingsgegevens (Content Credentials)');
  if (f.format === 'jpeg') low.push('Opnieuw opgeslagen als JPG (bijvoorbeeld via WhatsApp)');
  if (f.width && f.height) { const r = f.height / f.width; if (r < 1.5 || r > 2.4) low.push('Ongebruikelijk formaat voor een telefoonscreenshot (bijgesneden?)'); }
  // Eén zwak signaal is normaal (veel mensen sturen via WhatsApp). Twee zwakke of één sterk signaal: een mens kijkt.
  const risk = high.length || low.length >= 2 ? 'high' : low.length ? 'low' : 'none';
  return { risk, signals: [...high, ...low] };
}
