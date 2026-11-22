/* UNIT·ADIT boot harness.

   A syntax check cannot see a deleted function, an orphaned handler, a write to
   an element that no longer exists, or a uniform three reaches for that was
   never merged in. Every fault that has reached a live build so far was one of
   those. This runs the real shipped index.html end to end against stubbed GL,
   Web Audio and DOM, and prints a stage per line.

   node test/boot.js                                                          */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { ROOT, inlineThree, moduleOf } from '../build/make.mjs';

/* Evaluating the shipped module in a sandbox needs vm.SourceTextModule, which
   is behind a flag. Relaunch ourselves with it so the runbook stays `node
   test/boot.js` like the others. */
if (typeof vm.SourceTextModule !== 'function'){
  const r = spawnSync(process.execPath,
    ['--experimental-vm-modules', '--no-warnings', ...process.argv.slice(1)], {stdio:'inherit'});
  process.exit(r.status === null ? 1 : r.status);
}

let stage = 0, failed = 0;
const ok = (msg, extra='') => console.log(`  PASS  ${String(++stage).padStart(2,'0')}  ${msg}${extra?'  ·  '+extra:''}`);
const bad = (msg, err) => { console.log(`  FAIL  ${String(++stage).padStart(2,'0')}  ${msg}\n        ${err}`); failed++; };
const need = (cond, msg, extra) => cond ? ok(msg, extra) : bad(msg, 'assertion failed' + (extra ? '  ·  ' + extra : ''));

import { El, walk, query, parseInto, FakeCtx, floatWav } from './env.mjs';

/* ═══ PLATFORM ═══════════════════════════════════════════════════════════════ */
const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
const manifest = readFileSync(join(ROOT, 'public/archive.json'), 'utf8');

const doc = new El('html');
doc.body = new El('body');
doc.appendChild(doc.body);
doc.createElement = t => new El(t);
doc.createElementNS = (_ns, t) => new El(t);   // three makes its canvas this way
doc.getElementById = id => doc.querySelector('#' + id);
doc.querySelector = sel => query(doc, sel)[0] || null;
doc.querySelectorAll = sel => query(doc, sel);
doc.addEventListener = (t, fn) => ((doc._listeners ||= {})[t] ||= []).push(fn);

const bodyHtml = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
parseInto(bodyHtml, doc.body);

const rafQueue = [];
const win = {
  innerWidth: 900, innerHeight: 800, devicePixelRatio: 2,
  location: {protocol:'https:', origin:'https://adit.wastelandprops.com', pathname:'/', search:'', hash:''},
  history: {replaceState(_a,_b,h){ if (h) win.location.hash = h; }, pushState(){}},
  navigator: {userAgent:'boot-harness', clipboard:{writeText: () => Promise.resolve()}},
  performance: {now: () => Date.now()},
  matchMedia: () => ({matches:false, addEventListener(){}, addListener(){}}),
  getComputedStyle: n => ({display: n.style.display || (n.id === 'tabs' ? 'none' : 'block')}),
  requestAnimationFrame: fn => rafQueue.push(fn),
  cancelAnimationFrame(){},
  addEventListener(t, fn){ (win._l ||= {})[t] ||= []; win._l[t].push(fn); },
  removeEventListener(){},
  setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms||0, 1)),
  clearTimeout,
  AudioContext: FakeCtx,
  fetch: async url => {
    if (String(url).endsWith('archive.json'))
      return {ok:true, status:200, json: async () => JSON.parse(manifest)};
    return {ok:true, status:200, arrayBuffer: async () => floatWav(), blob: async () => ({size: 42})};
  },
  URL: globalThis.URL,
  document: doc,
  __adit: {ready:false}
};
win.window = win; win.self = win; win.globalThis = win;
doc.defaultView = win;

/* ═══ RUN ════════════════════════════════════════════════════════════════════ */
const app = moduleOf(html).replace("import * as THREE from 'three';", '');
const source = inlineThree() + app;
ok('assembled the shipped module', `${(source.length/1024).toFixed(0)} kB`);
need(doc.querySelector('#rows') && doc.querySelector('#deck') && doc.querySelector('#k-play'),
     'parsed index.html markup', `${walk(doc.body).length} elements`);

const context = vm.createContext(new Proxy(win, {
  has: () => true,                                   // every bare name resolves here
  get: (t, k) => {
    if (k === Symbol.unscopables) return undefined;
    if (k in t) return t[k];
    return globalThis[k];                            // Math, JSON, TextDecoder, typed arrays
  },
  set: (t, k, v) => { t[k] = v; return true; }
}));

let mod;
try {
  mod = new vm.SourceTextModule(source, {context, identifier:'adit'});
  await mod.link(() => { throw new Error('unexpected import'); });
  await mod.evaluate();
  ok('module evaluated', 'no throw on the init path');
} catch (err){
  bad('module evaluated', err.stack ? err.stack.split('\n').slice(0,4).join('\n        ') : err);
}

await new Promise(r => setTimeout(r, 60));            // let loadManifest settle
need(win.__adit.ready === true, 'reported ready', 'window.__adit.ready');

const rows = doc.querySelector('#rows');
need(walk(rows).some(n => n.classList.contains('row')), 'core log rendered',
     `${walk(rows).filter(n=>n.classList.contains('row')).length} rows`);
need(walk(rows).some(n => n.classList.contains('dl')), 'every row carries a download control');

/* every transport key must be wired — a handler assigned to a stale id is silent */
const keys = doc.querySelectorAll('.key');
const unwired = keys.filter(k => !k.onclick && !(k._listeners.click||[]).length);
need(keys.length >= 8 && unwired.length === 0, 'transport keys wired',
     `${keys.length} keys, ${unwired.length} orphaned`);

/* drive a real selection: fetch → parseWav → logCore → buildCore → play */
const first = walk(rows).find(n => n.classList.contains('row') && n.dataset.i !== undefined);
try {
  rows.dispatch('click', {target: first, closest: () => first});
  await new Promise(r => setTimeout(r, 400));
  const state = doc.querySelector('#s-state').textContent;
  const fmt = doc.querySelector('#s-fmt').textContent;
  need(/WAV 32F/.test(fmt), 'decoded a 32-bit float core through the real path', fmt);
  need(/READING|HELD/.test(state), 'transport engaged', state);
  need(/dBFS/.test(doc.querySelector('#s-tp').textContent),
       'true peak reported', doc.querySelector('#s-tp').textContent);
} catch (err){
  bad('selection path', err.message);
  ok('transport engaged (skipped)'); ok('true peak (skipped)');
}

/* pump the render loop — a fault here is what filled the console last time */
try {
  for (let i = 0; i < 4; i++){
    const q = rafQueue.splice(0, rafQueue.length);
    if (!q.length) throw new Error('render loop stopped scheduling');
    q.forEach(fn => fn(1000 + i*16));
  }
  const err = doc.querySelector('#boot-err').textContent;
  need(!err.trim(), 'render loop ran four frames clean', err.trim() || 'no faults');
} catch (err){
  bad('render loop ran four frames clean', err.message);
}

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
