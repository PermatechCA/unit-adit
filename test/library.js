/* UNIT·ADIT library harness: ADIT inside Public Workbench.

   Runs the shipped index.html in library mode (window.__workbench set, as the
   corner-mark script does) against a fake on-device file store (OPFS) and
   localStorage. Every file closed and every note written goes into one log,
   in order, so "all the files before the note" is something we can check.

   Kits (WORKBENCH.md, "Handing on more than one sound: kits (hand-off note v2)"):
     1  three FATHOM sounds sharing a kit id list as one kit, sounds in slot order
     2  only tools whose build.json "takes" includes "kit" are offered the kit
     3  sending a kit writes every file before the note; items in slot order
     4  a 20-sound kit sends 16, and says so before sending
     5  a LATHE wavetable goes with kind "waves", byte for byte, 'clm ' chunk and all

   node test/library.js                                                        */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { ROOT, inlineThree, moduleOf } from '../build/make.mjs';
import { El, walk, parseInto, FakeCtx, floatWav } from './env.mjs';

if (typeof vm.SourceTextModule !== 'function'){
  const r = spawnSync(process.execPath,
    ['--experimental-vm-modules', '--no-warnings', ...process.argv.slice(1)], {stdio:'inherit'});
  process.exit(r.status === null ? 1 : r.status);
}

let stage = 0, failed = 0;
const ok = (msg, extra='') => console.log(`  PASS  ${String(++stage).padStart(2,'0')}  ${msg}${extra?'  ·  '+extra:''}`);
const bad = (msg, err) => { console.log(`  FAIL  ${String(++stage).padStart(2,'0')}  ${msg}\n        ${err}`); failed++; };
const need = (cond, msg, extra) => cond ? ok(msg, extra) : bad(msg, 'assertion failed' + (extra ? '  ·  ' + extra : ''));
const settle = (ms = 60) => new Promise(r => setTimeout(r, ms));

/* ═══ OPFS: directories and files in memory, every close logged ═════════════ */
const LOG = [];
const notFound = n => Object.assign(new Error(n + ' not found'), {name: 'NotFoundError'});
const bytesOf = async x =>
  typeof x === 'string' ? new TextEncoder().encode(x)
  : x instanceof ArrayBuffer ? new Uint8Array(x)
  : ArrayBuffer.isView(x) ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength)
  : new Uint8Array(await x.arrayBuffer());                     // Blob or File
class FFile {
  constructor(name, path, data = new Uint8Array(0)){ this.kind = 'file'; this.name = name; this.path = path; this.data = data; }
  async getFile(){ return new File([this.data], this.name); }
  async createWritable(){
    const parts = [], self = this;
    return {
      async write(x){ parts.push(await bytesOf(x)); },
      async close(){
        const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n);
        let o = 0; for (const p of parts){ out.set(p, o); o += p.length; }
        self.data = out; LOG.push(['file', self.path]);
      }
    };
  }
}
class FDir {
  constructor(name = '', path = ''){ this.kind = 'directory'; this.name = name; this.path = path; this.kids = new Map(); }
  async getDirectoryHandle(n, o = {}){
    let d = this.kids.get(n);
    if (!d){ if (!o.create) throw notFound(n); d = new FDir(n, this.path + n + '/'); this.kids.set(n, d); }
    if (d.kind !== 'directory') throw Object.assign(new Error('type'), {name: 'TypeMismatchError'});
    return d;
  }
  async getFileHandle(n, o = {}){
    let f = this.kids.get(n);
    if (!f){ if (!o.create) throw notFound(n); f = new FFile(n, this.path + n); this.kids.set(n, f); }
    return f;
  }
  async removeEntry(n){ if (!this.kids.delete(n)) throw notFound(n); LOG.push(['rm', this.path + n]); }
  async *entries(){ for (const kv of [...this.kids]) yield kv; }
}
const ROOT_DIR = new FDir();
function put(path, data){                                       // seed a file without logging it
  const parts = path.split('/'), name = parts.pop();
  let d = ROOT_DIR;
  for (const p of parts){ if (!d.kids.has(p)) d.kids.set(p, new FDir(p, d.path + p + '/')); d = d.kids.get(p); }
  d.kids.set(name, new FFile(name, d.path + name, typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)));
}
function get(path){
  const parts = path.split('/'); let d = ROOT_DIR;
  for (const p of parts){ if (!d || !d.kids) return null; d = d.kids.get(p); }
  return d || null;
}

/* ═══ FIXTURES ════════════════════════════════════════════════════════════════ */
const pad = (s, n) => s.length < n ? s + ' '.repeat(n - s.length) : s;
function fathomSound(tool, id, title, kit, made){
  put(`shelf/${tool}/${id}.wav`, floatWav({rate: 48000, ch: 1, secs: 0.05}));
  put(`shelf/${tool}/${id}.json`, JSON.stringify({v: 1, tool, id, file: id + '.wav', title,
    made: new Date(made).toISOString(), ...(kit ? {kit} : {})}));
}
/* a LATHE wavetable: mono float, a 'clm ' chunk (Serum's frame-size tag) before the data */
function latheWav(){
  const clm = '<!>2048 01000000 wavetable LATHE', frames = 2048 * 4;
  const clmLen = clm.length + (clm.length & 1), dataLen = frames * 4;
  const buf = new ArrayBuffer(12 + 24 + 8 + clmLen + 8 + dataLen), dv = new DataView(buf);
  let p = 0; const tag = t => { for (const c of t) dv.setUint8(p++, c.charCodeAt(0)); };
  tag('RIFF'); dv.setUint32(p, buf.byteLength - 8, true); p += 4; tag('WAVE');
  tag('fmt '); dv.setUint32(p, 16, true); p += 4; dv.setUint16(p, 3, true); p += 2; dv.setUint16(p, 1, true); p += 2;
  dv.setUint32(p, 48000, true); p += 4; dv.setUint32(p, 48000*4, true); p += 4; dv.setUint16(p, 4, true); p += 2; dv.setUint16(p, 32, true); p += 2;
  tag('clm '); dv.setUint32(p, clm.length, true); p += 4; tag(clm); if (clm.length & 1) dv.setUint8(p++, 0);
  tag('data'); dv.setUint32(p, dataLen, true); p += 4;
  for (let i = 0; i < frames; i++, p += 4) dv.setFloat32(p, Math.sin(i / 2048 * Math.PI * 2 * (1 + (i >> 11))) * 0.8, true);
  return buf;
}
const now = Date.now();
// Harbour kit: three sounds, written to the shelf out of pad order
fathomSound('fathom', 'h3', 'Harbour — hat',   {id: 'k-harbour', name: 'Harbour kit', slot: 3}, now - 1000);
fathomSound('fathom', 'h1', 'Harbour — kick',  {id: 'k-harbour', name: 'Harbour kit', slot: 1}, now - 3000);
fathomSound('fathom', 'h2', 'Harbour — snare', {id: 'k-harbour', name: 'Harbour kit', slot: 2}, now - 2000);
// Long kit: twenty sounds
for (let i = 20; i >= 1; i--)
  fathomSound('fathom', 'l' + i, 'Long — pad ' + i, {id: 'k-long', name: 'Long kit', slot: i}, now - 60000 - i*10);
// a FATHOM sound with no kit stays a single sound
fathomSound('fathom', 'solo', 'Solo one-shot', null, now - 500);
// a LATHE wavetable
const LATHE = latheWav();
put('shelf/lathe/w1-table.wav', LATHE);
put('shelf/lathe/w1.json', JSON.stringify({v: 1, tool: 'lathe', id: 'w1', file: 'w1-table.wav', title: 'Hawk table',
  made: new Date(now - 200).toISOString()}));
// a kit with one sound left in it is just a sound (a kit note carries 2 to 16)
fathomSound('fathom', 'lone', 'Lone — kick', {id: 'k-lone', name: 'Lone kit', slot: 1}, now - 400);
// two LATHE wavetables that share a kit: they go byte for byte inside a kit too
for (const [id, slot] of [['t1', 1], ['t2', 2]]){
  put(`shelf/lathe/${id}-table.wav`, LATHE);
  put(`shelf/lathe/${id}.json`, JSON.stringify({v: 1, tool: 'lathe', id, file: id + '-table.wav', title: 'Table ' + slot,
    made: new Date(now - 300 - slot).toISOString(), kit: {id: 'k-tables', name: 'Tables', slot}}));
}

const BUILD = {tools: [
  {id: 'ps1', name: 'PS-1', takes: ['audio', 'kit']},
  {id: 'sluice', name: 'SLUICE', accepts: true},
  {id: 'fathom', name: 'FATHOM', takes: ['audio']}
]};

/* ═══ PLATFORM ════════════════════════════════════════════════════════════════ */
const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
const manifest = readFileSync(join(ROOT, 'public/archive.json'), 'utf8');
const doc = new El('html');
doc.body = new El('body'); doc.appendChild(doc.body);
doc.createElement = t => new El(t);
doc.createElementNS = (_ns, t) => new El(t);
doc.getElementById = id => doc.querySelector('#' + id);
doc.querySelector = sel => doc.querySelectorAll(sel)[0] || null;
doc.querySelectorAll = sel => El.prototype.querySelectorAll.call(doc, sel);
doc.addEventListener = (t, fn) => ((doc._listeners ||= {})[t] ||= []).push(fn);
parseInto(html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>')), doc.body);

const NAV = [], STORE = {};
const location = {protocol: 'https:', origin: 'https://workbench.wastelandprops.com', pathname: '/adit/', search: '', hash: '',
  get href(){ return this.origin + this.pathname; }, set href(v){ NAV.push(String(v)); }};
const win = {
  innerWidth: 900, innerHeight: 800, devicePixelRatio: 2, location,
  history: {replaceState(){}, pushState(){}},
  navigator: {userAgent: 'library-harness', clipboard: {writeText: () => Promise.resolve()},
              storage: {getDirectory: async () => ROOT_DIR}},
  localStorage: {getItem: k => (k in STORE ? STORE[k] : null), removeItem: k => { delete STORE[k]; },
                 setItem: (k, v) => { STORE[k] = String(v); LOG.push(['note', k]); }},
  performance: {now: () => Date.now()},
  matchMedia: () => ({matches: false, addEventListener(){}, addListener(){}}),
  getComputedStyle: n => ({display: n.style.display || (n.id === 'tabs' ? 'none' : 'block'), fontFamily: 'monospace'}),
  requestAnimationFrame(){}, cancelAnimationFrame(){},
  addEventListener(){}, removeEventListener(){},
  setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, 1)), clearTimeout,
  AudioContext: FakeCtx,
  fetch: async url => {
    url = String(url);
    if (url.endsWith('archive.json')) return {ok: true, status: 200, json: async () => JSON.parse(manifest)};
    if (url.endsWith('build.json')) return {ok: true, status: 200, json: async () => BUILD};
    return {ok: true, status: 200, arrayBuffer: async () => floatWav({rate: 48000, ch: 2, secs: 0.1})};
  },
  URL: globalThis.URL, File: globalThis.File, Blob: globalThis.Blob,
  document: doc,
  __adit: {ready: false},
  __workbench: {tool: 'adit', app: false}
};
win.window = win; win.self = win; win.globalThis = win;
doc.defaultView = win;

const context = vm.createContext(new Proxy(win, {
  has: () => true,
  get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; return globalThis[k]; },
  set: (t, k, v) => { t[k] = v; return true; }
}));
try {
  const mod = new vm.SourceTextModule(inlineThree() + moduleOf(html).replace("import * as THREE from 'three';", ''),
    {context, identifier: 'adit'});
  await mod.link(() => { throw new Error('unexpected import'); });
  await mod.evaluate();
} catch (err){ bad('module evaluated in library mode', err.stack ? err.stack.split('\n').slice(0, 4).join('\n        ') : err); }
for (let i = 0; i < 50 && !win.__adit.ready; i++) await settle(20);
await settle(80);
need(win.__adit.ready === true && win.__adit.library, 'library mode booted', 'window.__adit.library present');

const L = win.__adit.library, rows = doc.querySelector('#rows');
const rowEls = () => walk(rows).filter(n => n.classList.contains('row'));
const titleOf = n => (walk(n).find(c => c.classList.contains('t')) || {textContent: ''}).textContent;
const click = n => rows.dispatch('click', {target: n});
const kitRow = key => rowEls().find(n => n.attributes['data-kit'] === key);
const isFloatWav = u8 => { const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); return dv.getUint16(20, true) === 3 && dv.getUint16(34, true) === 32; };

/* ─── 1  three sidecars sharing a kit id: one kit entry, sounds in slot order ─── */
{
  const kr = kitRow('fathom:k-harbour');
  const before = rowEls().filter(n => /HARBOUR —/.test(titleOf(n))).length;
  need(kr && titleOf(kr) === 'HARBOUR KIT' && /3 SOUNDS/.test(walk(kr).map(c => c.textContent).join(' ')) && before === 0,
       'three FATHOM sounds sharing a kit id list as one kit entry, closed', kr ? titleOf(kr) + ' · members shown closed: ' + before : 'no kit row');
  click(kr); await settle();
  const after = rowEls().map(titleOf);
  const at = after.indexOf('HARBOUR KIT');
  need(JSON.stringify(after.slice(at + 1, at + 4)) === JSON.stringify(['HARBOUR — KICK', 'HARBOUR — SNARE', 'HARBOUR — HAT']),
       'opened, its sounds follow in slot order', after.slice(at + 1, at + 4).join(' · '));
  need(after.includes('SOLO ONE-SHOT') && !rowEls().some(n => n.attributes['data-kit'] && titleOf(n) === 'SOLO ONE-SHOT'),
       'a sound with no kit field stays a single sound');
}

/* ─── 2  only tools that take kits are offered the kit ─── */
{
  const kitKeys = walk(rows).filter(n => n.attributes['data-kitsend'] && n.attributes['data-kitof'] === 'fathom:k-harbour').map(n => n.attributes['data-kitsend']);
  need(JSON.stringify(kitKeys) === '["ps1"]', 'Send kit to lists only PS-1 (the only tool whose takes includes "kit")', kitKeys.join(', '));
  const single = walk(doc.querySelector('#sendkeys')).filter(n => n.attributes['data-to']).map(n => n.attributes['data-to']);
  need(JSON.stringify(single) === '["ps1","sluice","fathom"]', 'single sounds still go to every tool that takes audio (takes or accepts)', single.join(', '));
}

/* ─── 3  send a kit: every file first, then the note; items in slot order ─── */
{
  const mark = LOG.length;
  const btn = walk(rows).find(n => n.attributes['data-kitsend'] === 'ps1' && n.attributes['data-kitof'] === 'fathom:k-harbour');
  click(btn);
  for (let i = 0; i < 100 && !NAV.length; i++) await settle(10);
  const log = LOG.slice(mark), noteAt = log.findIndex(x => x[0] === 'note');
  const files = log.filter(x => x[0] === 'file' && x[1].startsWith('shelf/_handoff/'));
  need(files.length === 3 && noteAt > 0 && log.slice(0, noteAt).filter(x => x[0] === 'file').length === 3,
       'all three files written into shelf/_handoff/ before the note', `${files.length} files, note at step ${noteAt + 1} of ${log.length}`);
  const n = JSON.parse(STORE['wb.handoff'] || 'null') || {};
  need(n.v === 2 && n.kind === 'kit' && n.to === 'ps1' && n.title === 'Harbour kit' && typeof n.at === 'number' && Array.isArray(n.items),
       'note is v2: kind kit, to, title, at, items', JSON.stringify({v: n.v, kind: n.kind, to: n.to, title: n.title}));
  const it = n.items || [];
  need(it.map(x => x.title).join('|') === 'HARBOUR — KICK|HARBOUR — SNARE|HARBOUR — HAT',
       'items in slot order', it.map(x => x.title).join(' · '));
  need(it.every(x => x.file && x.name && x.title && x.bytes > 44 && x.region === null && x.from && x.from.tool === 'fathom' && x.from.id),
       'each item: file, name, title, bytes, region null, from {tool, id}', it.map(x => x.from && x.from.id).join(' '));
  const real = it.map(x => get(x.file));
  need(real.every((f, k) => f && f.data.length === it[k].bytes && isFloatWav(f.data)),
       'each item is on the shelf as 32-bit float WAV, at the size the note says');
  need(NAV[NAV.length - 1] === '../ps1/?handoff', 'then opens PS-1 with ?handoff', NAV[NAV.length - 1]);
}

/* ─── 4  a 20-sound kit: sends 16, and says so before sending ─── */
{
  await settle(10);
  click(kitRow('fathom:k-long')); await settle();
  const btn = walk(rows).find(n => n.attributes['data-kitsend'] === 'ps1' && n.attributes['data-kitof'] === 'fathom:k-long');
  need(btn && /FIRST 16 OF 20/i.test(btn.textContent), 'the button says "first 16 of 20" before anything is sent', btn && btn.textContent);
  const navs = NAV.length;
  click(btn);
  for (let i = 0; i < 200 && NAV.length === navs; i++) await settle(10);
  const n = JSON.parse(STORE['wb.handoff'] || 'null') || {};
  need(n.items && n.items.length === 16 && n.items.map(x => x.title).join('|') === Array.from({length: 16}, (_, k) => 'LONG — PAD ' + (k + 1)).join('|'),
       'sends the first sixteen, pads 1 to 16 in order', `${n.items && n.items.length} items`);
  need(/first 16 of 20/.test(doc.querySelector('#s-hint').textContent), 'and says so while sending', doc.querySelector('#s-hint').textContent);
}

/* ─── 5  a LATHE wavetable: kind waves, byte for byte, 'clm ' chunk and all ─── */
{
  await settle(10);
  const lr = rowEls().find(n => titleOf(n) === 'HAWK TABLE');
  click(lr);
  for (let i = 0; i < 100 && (L.S.busy || !L.S.entries[L.S.current] || L.S.entries[L.S.current].title !== 'HAWK TABLE'); i++) await settle(10);
  L.S.rgnA = 0.01; L.S.rgnB = 0.05;                              // a marked A/B must not cut a wavetable
  const navs = NAV.length;
  await L.sendTo({id: 'ps1', name: 'PS-1'});
  for (let i = 0; i < 100 && NAV.length === navs; i++) await settle(10);
  const n = JSON.parse(STORE['wb.handoff'] || 'null') || {};
  const f = get(n.file || ''), sent = f ? f.data : new Uint8Array(0), src = new Uint8Array(LATHE);
  const same = sent.length === src.length && sent.every((b, k) => b === src[k]);
  const hasClm = Buffer.from(sent).includes(Buffer.from('clm '));
  need(n.v === 1 && n.kind === 'waves' && n.region === null, 'sent with kind "waves", no region even with A/B marked', JSON.stringify({kind: n.kind, region: n.region}));
  need(same && hasClm, "the hand-off file is byte-identical to LATHE's, 'clm ' chunk included", `${sent.length} of ${src.length} bytes`);
  // and an ordinary single sound says kind "sound"
  const sr = rowEls().find(n2 => titleOf(n2) === 'SOLO ONE-SHOT');
  click(sr);
  for (let i = 0; i < 100 && (L.S.busy || !L.S.entries[L.S.current] || L.S.entries[L.S.current].title !== 'SOLO ONE-SHOT'); i++) await settle(10);
  L.S.rgnA = null; L.S.rgnB = null;
  await settle(10);
  await L.sendTo({id: 'sluice', name: 'SLUICE'});
  const n2 = JSON.parse(STORE['wb.handoff'] || 'null') || {};
  need(n2.v === 1 && n2.kind === 'sound' && n2.to === 'sluice', 'a single sound says kind "sound"', JSON.stringify({v: n2.v, kind: n2.kind}));
}

/* ─── 6  a kit of one is a sound; wavetables in a kit go byte for byte ─── */
{
  await settle(10);
  need(!kitRow('fathom:k-lone') && rowEls().some(n => titleOf(n) === 'LONE — KICK' && !n.attributes['data-kit']),
       'a kit with one sound left lists as that sound, with no Send kit');
  if (kitRow('lathe:k-tables').attributes['aria-expanded'] !== 'true') click(kitRow('lathe:k-tables'));
  await settle();
  const navs = NAV.length;
  click(walk(rows).find(n => n.attributes['data-kitsend'] === 'ps1' && n.attributes['data-kitof'] === 'lathe:k-tables'));
  for (let i = 0; i < 100 && NAV.length === navs; i++) await settle(10);
  const n = JSON.parse(STORE['wb.handoff'] || 'null') || {}, src = new Uint8Array(LATHE);
  const same = (n.items || []).map(x => get(x.file)).every(f => f && f.data.length === src.length && f.data.every((b, k) => b === src[k]));
  need(n.kind === 'kit' && n.items && n.items.length === 2 && same, "wavetables in a kit are byte-identical to LATHE's, 'clm ' chunk and all",
       `${n.items && n.items.length} items`);
}

/* ─── and the kit can go: delete takes each member, sidecar first ─── */
{
  await settle(10);
  const mark = LOG.length;
  if (!kitRow('fathom:k-harbour').attributes['aria-expanded'] || kitRow('fathom:k-harbour').attributes['aria-expanded'] === 'false') click(kitRow('fathom:k-harbour'));
  await settle();
  const del = () => walk(rows).find(n => n.attributes['data-kitdel'] === 'fathom:k-harbour');
  click(del()); click(del());                    // the second tap inside the window, as a hand would
  for (let i = 0; i < 200 && (get('shelf/fathom/h3.wav') || kitRow('fathom:k-harbour')); i++) await settle(10);
  const rm = LOG.slice(mark).filter(x => x[0] === 'rm').map(x => x[1].replace('shelf/fathom/', ''));
  const order = ['h1', 'h2', 'h3'].every(id => rm.indexOf(id + '.json') >= 0 && rm.indexOf(id + '.json') < rm.indexOf(id + '.wav'));
  need(!kitRow('fathom:k-harbour') && order && !get('shelf/fathom/h2.wav'), 'Delete kit removes every member, each sidecar before its audio', rm.join(' '));
}

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
