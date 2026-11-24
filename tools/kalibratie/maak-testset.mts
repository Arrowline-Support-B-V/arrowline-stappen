// Maakt een kleine nagebouwde testset om het kalibratiescript te proberen (geen echte screenshots).
import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2] ?? 'kalibratie/testset'; fs.mkdirSync(dir, { recursive: true });
const enc = (s: string) => new TextEncoder().encode(s), be32 = (n: number) => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];
const chunk = (t: string, d: Uint8Array) => [...be32(d.length), ...enc(t), ...d, 0, 0, 0, 0];
const png = (w: number, h: number, extra: number[][] = []) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, ...chunk('IHDR', new Uint8Array([...be32(w), ...be32(h), 8, 6, 0, 0, 0])), ...extra.flat(), ...chunk('IDAT', new Uint8Array([1])), ...chunk('IEND', new Uint8Array())]);
const rows = ['bestand,dag,stappen,bewerkt,app'];
const apps = ['Gezondheid', 'Samsung Health', 'Garmin Connect', 'Health Connect', 'Fitbit'];
for (let i = 1; i <= 40; i++) { const app = apps[i % apps.length], edited = i % 8 === 0, ps = edited && i % 16 === 0, name = `shot-${String(i).padStart(2, '0')}.png`;
  fs.writeFileSync(path.join(dir, name), png(1080, 2340, ps ? [chunk('tEXt', enc('Software\0Adobe Photoshop 25.0'))] : []));
  rows.push(`${name},2027-01-${String(1 + (i % 18)).padStart(2, '0')},${9000 + i * 317},${edited ? 'ja' : 'nee'},${app}`); }
fs.writeFileSync(path.join(dir, 'waarheid.csv'), rows.join('\n')); console.log(`Testset gemaakt in ${dir} (40 bestanden, 5 bewerkt)`);
