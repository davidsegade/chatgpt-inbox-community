export const MAX_BYTES = 131072;
export const bytes = (s: string) => new TextEncoder().encode(s).length;
export function safePath(value: unknown, markdown = true): string {
  if (typeof value !== 'string' || !value || value !== value.normalize('NFC') || bytes(value) > 800 || /[\\%:#?\x00-\x1f\x7f]/.test(value)) throw Error('Ruta no válida');
  const parts = value.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || p.startsWith('.') || /[<>"|*]/.test(p) || /[. ]$/.test(p) || p.trim() !== p || bytes(p) > 180 || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(p))) throw Error('Ruta no válida');
  if (markdown && !value.endsWith('.md')) throw Error('Solo Markdown .md');
  return value;
}
export function inConfigDir(path: string, configDir: string): boolean {
  const p = path.toLowerCase();
  const c = configDir.normalize('NFC').toLowerCase();
  return p === c || p.startsWith(c + '/');
}
export function allowed(path: string, roots: string[], configDir: string): boolean {
  safePath(path);
  if (inConfigDir(path, configDir)) return false;
  return roots.some(root => { if(root === '*') return true; const r = safePath(root, false); return path.startsWith(r + '/'); });
}
// Every write needs an explicit authorization check. Reading a path is a write
// of the same weight, so callers must never widen the scope to read.
export function authorize(path: string, roots: string[], configDir: string): void {
  if (!allowed(path, roots, configDir)) throw Error('Ruta fuera de la lista permitida');
}
export interface Job { version: 1; id: string; path: string; content: string }
// Structural validation only: size, schema, reserved marker, safe path and the
// Obsidian configuration directory. Folder scope is checked separately so that a
// caller can validate an envelope before deciding whether to read anything.
export function parseEnvelope(raw: string, configDir: string): Job {
  if (bytes(raw) > MAX_BYTES) throw Error('Solicitud demasiado grande');
  const j = JSON.parse(raw);
  if (!j || j.version !== 1 || typeof j.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(j.id) || typeof j.content !== 'string' || Object.keys(j).some(k => !['version','id','path','content'].includes(k))) throw Error('Solicitud no válida');
  if(j.content.includes('<!-- chatgpt-inbox-note:'))throw Error('El contenido utiliza un identificador reservado');
  safePath(j.path);
  if (inConfigDir(j.path, configDir)) throw Error('Ruta fuera de la lista permitida');
  return j;
}
export function parseJob(raw: string, roots: string[], configDir: string): Job {
  const j = parseEnvelope(raw, configDir);
  authorize(j.path, roots, configDir);
  return j;
}

// Portable SHA-256. WebCrypto is unavailable outside a secure context, so the
// plugin must not depend on crypto.subtle to deliver a note on every platform.
const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;
export function sha256Hex(text: string): string {
  const input = new TextEncoder().encode(text);
  const padded = new Uint8Array((input.length + 9 + 63) & ~63);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(input.length / 0x20000000));
  view.setUint32(padded.length - 4, (input.length * 8) >>> 0);
  const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = (rotr(a,7) ^ rotr(a,18) ^ (a >>> 3)) >>> 0;
      const s1 = (rotr(b,17) ^ rotr(b,19) ^ (b >>> 10)) >>> 0;
      w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e,6) ^ rotr(e,11) ^ rotr(e,25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = (rotr(a,2) ^ rotr(a,13) ^ rotr(a,22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
  return Array.from(out).map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function digest(s: string): Promise<string> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (subtle) return Array.from(new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
  } catch { /* Fall back to the portable implementation below. */ }
  return sha256Hex(s);
}
// SecretStorage identifiers are lowercase alphanumeric with optional dashes.
export const SECRET_ID = /^[a-z0-9-]+$/;
export function secretId(value: string): string {
  const id = value.trim();
  if (!SECRET_ID.test(id)) throw Error('El nombre del secreto usa solo minúsculas, números y guiones.');
  return id;
}
// A random token for device credentials. crypto.randomUUID is missing on older
// mobile WebViews, so the identifier is rebuilt from random bytes.
export function randomToken(): string {
  const g = globalThis.crypto;
  if (g && typeof g.randomUUID === 'function') return g.randomUUID();
  const bytes = new Uint8Array(16);
  if (g && typeof g.getRandomValues === 'function') g.getRandomValues(bytes);
  else throw Error('Este dispositivo no ofrece un generador aleatorio seguro.');
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export interface LocalVault {
  read(path: string): Promise<string | null>;
  create(path: string, content: string): Promise<void>;
}
export type Ledger = Record<string, string>;
export async function deliver(j: Job, ledger: Ledger, vault: LocalVault): Promise<string> {
  const hash = await digest(JSON.stringify([j.path,j.content]));
  const previous = Object.prototype.hasOwnProperty.call(ledger,j.id) ? ledger[j.id] : undefined;
  if (previous && previous !== hash) throw Error('ID reutilizado con contenido distinto');
  if (previous) return 'duplicada';
  const existing = await vault.read(j.path);
  if (existing !== null && existing !== j.content) return 'conflicto: se conserva la nota local';
  if (existing === null) await vault.create(j.path,j.content);
  ledger[j.id] = hash;
  return existing === null ? 'creada' : 'ya presente';
}
