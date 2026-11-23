/* UNIT·ADIT pick harness: ADIT as Workbench's library sheet, /adit/?pick=<tool>.

   A tool's Open asks Workbench for a sound; Workbench opens ADIT in a framed sheet and ADIT posts the
   chosen sound back to the parent (WORKBENCH.md, "Choosing from the library inside a tool"):
     1  /adit/?pick=lathe shows the compact list with Cancel, and no rename, delete or Send to
     2  Use on a FIELD recording posts wb-pick with the stored bytes, the title and from
     3  Use on a LATHE sound posts kind "waves" and bytes identical to the stored file
     4  Cancel posts wb-pick-cancel
     5  messages go only to location.origin
   and: a marked A/B goes as just that region, 32-bit float; nothing app-wide is written while framed.

   node test/pick.js                                                           */

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
const now = Date.now();
const FIELD_WAV = floatWav({rate: 48000, ch: 2, secs: 1});
put('recordings/7h2k.wav', FIELD_WAV);
put('recordings/7h2k.json', JSON.stringify({id: '7h2k', state: 'done', file: '7h2k.wav', startMs: now - 5000,
  bytes: FIELD_WAV.byteLength, durationSec: 1, meta: {title: 'Harbour gulls'}}));
/* a LATHE wavetable: mono float with a 'clm ' chunk before the data */
function latheWav(){
  const clm = '<!>2048 01000000 wavetable LATHE', frames = 2048 * 2;
  const clmLen = clm.length + (clm.length & 1), dataLen = frames * 4;
  const buf = new ArrayBuffer(12 + 24 + 8 + clmLen + 8 + dataLen), dv = new DataView(buf);
  let p = 0; const tag = t => { for (const c of t) dv.setUint8(p++, c.charCodeAt(0)); };
  tag('RIFF'); dv.setUint32(p, buf.byteLength - 8, true); p += 4; tag('WAVE');
  tag('fmt '); dv.setUint32(p, 16, true); p += 4; dv.setUint16(p, 3, true); p += 2; dv.setUint16(p, 1, true); p += 2;
  dv.setUint32(p, 48000, true); p += 4; dv.setUint32(p, 48000*4, true); p += 4; dv.setUint16(p, 4, true); p += 2; dv.setUint16(p, 32, true); p += 2;
  tag('clm '); dv.setUint32(p, clm.length, true); p += 4; tag(clm); if (clm.length & 1) dv.setUint8(p++, 0);
  tag('data'); dv.setUint32(p, dataLen, true); p += 4;
  for (let i = 0; i < frames; i++, p += 4) dv.setFloat32(p, Math.sin(i / 2048 * Math.PI * 2) * 0.8, true);
  return buf;
}
const LATHE = latheWav();
put('shelf/lathe/w1-table.wav', LATHE);
put('shelf/lathe/w1.json', JSON.stringify({v: 1, tool: 'lathe', id: 'w1', file: 'w1-table.wav', title: 'Hawk table',
  made: new Date(now - 200).toISOString()}));
// a kit, so we can see its Send and Delete stay out of a picker
for (const [id, slot] of [['h1', 1], ['h2', 2]]){
  put(`shelf/fathom/${id}.wav`, floatWav({rate: 48000, ch: 1, secs: 0.05}));
  put(`shelf/fathom/${id}.json`, JSON.stringify({v: 1, tool: 'fathom', id, file: id + '.wav', title: 'Harbour ' + slot,
    made: new Date(now - 100 - slot).toISOString(), kit: {id: 'k-h', name: 'Harbour kit', slot}}));
}
const BUILD = {tools: [{id: 'lathe', name: 'LATHE', takes: ['audio']}, {id: 'ps1', name: 'PS-1', takes: ['audio', 'kit']}]};

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

const NAV = [], STORE = {}, POSTS = [], HIST = [];
const location = {protocol: 'https:', origin: 'https://workbench.wastelandprops.com', pathname: '/adit/', search: '?pick=lathe&kind=audio', hash: '',
  get href(){ return this.origin + this.pathname; }, set href(v){ NAV.push(String(v)); }};
const win = {
  innerWidth: 900, innerHeight: 800, devicePixelRatio: 2, location,
  history: {replaceState(){ HIST.push('replace'); }, pushState(){ HIST.push('push'); }},
  parent: {postMessage(msg, origin, transfer){ POSTS.push({msg, origin, transfer}); }},
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
  __workbench: {tool: 'adit', app: false, framed: true}
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
need(win.__adit.ready === true && win.__adit.library, 'pick mode booted', 'window.__adit.library present');

const L = win.__adit.library, rows = doc.querySelector('#rows');
const rowEls = () => walk(rows).filter(n => n.classList.contains('row'));
const titleOf = n => (walk(n).find(c => c.classList.contains('t')) || {textContent: ''}).textContent;
const rowOf = t => rowEls().find(n => titleOf(n) === t);
const useOf = t => walk(rowOf(t) || new El('x')).find(n => n.attributes['data-use']);
const click = n => n && (n.onclick ? n.onclick({target: n}) : rows.dispatch('click', {target: n}));
const same = (a, b) => { a = new Uint8Array(a); b = new Uint8Array(b); return a.length === b.length && a.every((x, k) => x === b[k]); };
const lastPost = async n => { for (let i = 0; i < 100 && POSTS.length < n; i++) await settle(10); return POSTS[n - 1]; };

/* ─── 1  compact list, Cancel, nothing that edits or sends ─── */
{
  const bar = doc.querySelector('#pickbar'), cancel = doc.querySelector('#pk-cancel');
  need(doc.body.dataset.pick === 'lathe' && bar && !bar.hidden && cancel,
       'pick=lathe: body is in pick mode, with the pick bar and Cancel');
  need(/Choose a sound for LATHE/.test(doc.querySelector('#pk-title').textContent),
       'titled plainly', doc.querySelector('#pk-title').textContent);
  click(rowEls().find(n => n.attributes['data-kit']));
  await settle();
  const all = walk(rows);
  need(rowOf('HARBOUR GULLS') && useOf('HARBOUR GULLS') && useOf('HAWK TABLE') && useOf('HARBOUR 1'),
       'every sound has a Use, kit members too');
  need(!all.some(n => n.classList.contains('dl') || n.attributes['data-kitsend'] || n.attributes['data-kitdel']),
       'no download, Send kit or Delete kit in the list');
  click(rowOf('HARBOUR GULLS'));
  for (let i = 0; i < 100 && (L.S.busy || !L.S.entries[L.S.current] || L.S.entries[L.S.current].title !== 'HARBOUR GULLS'); i++) await settle(10);
  await settle();
  const act = doc.querySelector('#actrow'), send = doc.querySelector('#sendrow');
  need(L.S.entries[L.S.current].title === 'HARBOUR GULLS' && act.hidden && !walk(act).some(n => n.attributes['data-act']) && send.hidden,
       'a loaded sound previews, with no Rename, Delete or Send to', `actrow hidden ${act.hidden}, sendrow hidden ${send.hidden}`);
}

/* ─── 2  Use on a FIELD recording: the stored bytes, title, from ─── */
{
  click(useOf('HARBOUR GULLS'));
  const p = await lastPost(1), m = (p && p.msg) || {};
  need(m.type === 'wb-pick' && same(m.bytes, FIELD_WAV), 'Use posts wb-pick with the bytes exactly as stored',
       `${m.bytes && m.bytes.byteLength} of ${FIELD_WAV.byteLength} bytes`);
  need(m.title === 'HARBOUR GULLS' && m.kind === 'sound' && m.from && m.from.tool === 'field' && m.from.id === '7h2k'
       && /\.wav$/.test(m.name) && m.mime === 'audio/wav',
       'with its title, kind "sound", from {field, 7h2k}, a .wav name and audio/wav', JSON.stringify({name: m.name, from: m.from}));
}

/* ─── 2b  a marked A/B goes as just that region, 32-bit float ─── */
{
  await settle(20);
  L.S.rgnA = 0.25; L.S.rgnB = 0.75;
  click(useOf('HARBOUR GULLS'));
  const p = await lastPost(2), m = (p && p.msg) || {};
  const dv = m.bytes ? new DataView(m.bytes) : null;
  const frames = dv ? (m.bytes.byteLength - 44) / (2 * 4) : 0;
  need(dv && dv.getUint16(20, true) === 3 && dv.getUint16(34, true) === 32 && frames === 24000 && /-0\.25-0\.75\.wav$/.test(m.name),
       'with A/B marked, only the region goes, as 32-bit float WAV', `${frames} frames · ${m.name}`);
  L.S.rgnA = null; L.S.rgnB = null;
}

/* ─── 3  Use on a LATHE sound: kind waves, byte for byte ─── */
{
  await settle(20);
  click(useOf('HAWK TABLE'));
  const p = await lastPost(3), m = (p && p.msg) || {};
  need(m.type === 'wb-pick' && m.kind === 'waves' && same(m.bytes, LATHE) && Buffer.from(new Uint8Array(m.bytes)).includes(Buffer.from('clm ')),
       "Use on a LATHE sound posts kind \"waves\", bytes identical to the stored file, 'clm ' included",
       `${m.bytes && m.bytes.byteLength} of ${LATHE.byteLength} bytes`);
  need(m.from && m.from.tool === 'lathe' && m.from.id === 'w1', 'from {lathe, w1}');
}

/* ─── 4  Cancel ─── */
{
  click(doc.querySelector('#pk-cancel'));
  const p = await lastPost(4), m = (p && p.msg) || {};
  need(m.type === 'wb-pick-cancel', 'Cancel posts wb-pick-cancel');
}

/* ─── 5  only to location.origin; bytes transferred; nothing app-wide written ─── */
{
  need(POSTS.length === 4 && POSTS.every(p => p.origin === 'https://workbench.wastelandprops.com'),
       'every message goes to location.origin, never "*"', POSTS.map(p => p.origin).join(' '));
  need(POSTS.filter(p => p.msg.type === 'wb-pick').every(p => p.transfer && p.transfer[0] === p.msg.bytes),
       'the bytes are transferred, not copied');
  need(!LOG.length && !Object.keys(STORE).length && !HIST.length,
       'while framed: no file written, no localStorage, no history change', `${LOG.length} writes, ${Object.keys(STORE).length} keys, ${HIST.length} history`);
}

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
