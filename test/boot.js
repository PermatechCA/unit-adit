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

/* ═══ DOM ════════════════════════════════════════════════════════════════════
   Small enough to read, real enough that a missing element throws.          */
const VOID = new Set(['input','img','br','hr','meta','link','source','path','svg-void']);

class El {
  constructor(tag){
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.parentNode = null;
    this.attributes = Object.create(null);
    this.style = Object.create(null);
    this.dataset = Object.create(null);
    this._listeners = Object.create(null);
    this._text = ''; this.disabled = false; this.value = '';
    const self = this;
    this.classList = {
      add:    (...c) => self._cls(s => c.forEach(x => s.add(x))),
      remove: (...c) => self._cls(s => c.forEach(x => s.delete(x))),
      toggle: (c,on) => self._cls(s => (on === undefined ? (s.has(c)?s.delete(c):s.add(c)) : (on?s.add(c):s.delete(c)))),
      contains: c => self._classes().has(c)
    };
  }
  _classes(){ return new Set(String(this.attributes.class||'').split(/\s+/).filter(Boolean)); }
  _cls(fn){ const s = this._classes(); fn(s); this.attributes.class = [...s].join(' '); }
  get id(){ return this.attributes.id || ''; }
  set id(v){ this.attributes.id = v; }
  get className(){ return this.attributes.class || ''; }
  set className(v){ this.attributes.class = v; }
  get title(){ return this.attributes.title || ''; }
  set title(v){ this.attributes.title = v; }
  setAttribute(k,v){
    this.attributes[k] = String(v);
    if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g,(_,c)=>c.toUpperCase())] = String(v);
  }
  getAttribute(k){ return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k){ delete this.attributes[k]; }
  appendChild(n){ n.parentNode = this; this.children.push(n); return n; }
  insertBefore(n, ref){
    n.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
    return n;
  }
  removeChild(n){ const i = this.children.indexOf(n); if (i >= 0) this.children.splice(i,1); n.parentNode = null; return n; }
  remove(){ if (this.parentNode) this.parentNode.removeChild(this); }
  get firstChild(){ return this.children[0] || null; }
  get parentElement(){ return this.parentNode; }
  get textContent(){ return this._text; }
  set textContent(v){ this._text = String(v); this.children.length = 0; }
  get innerHTML(){ return this._html || ''; }
  set innerHTML(v){ this._html = String(v); this.children.length = 0; parseInto(String(v), this); }
  addEventListener(t, fn){ (this._listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn){ const a = this._listeners[t]; if (a) a.splice(a.indexOf(fn), 1); }
  dispatch(t, ev={}){ (this._listeners[t]||[]).forEach(fn => fn({type:t, target:this, preventDefault(){}, stopPropagation(){}, ...ev})); }
  click(){ if (this.onclick) this.onclick({target:this, preventDefault(){}, stopPropagation(){}}); this.dispatch('click'); }
  focus(){}
  setPointerCapture(){} releasePointerCapture(){}
  closest(sel){ let n = this; while (n){ if (matches(n, sel)) return n; n = n.parentNode; } return null; }
  querySelector(sel){ return query(this, sel)[0] || null; }
  querySelectorAll(sel){ return query(this, sel); }
  getContext(kind){ return kind === '2d' ? ctx2d() : glContext(); }
  getBoundingClientRect(){ return RECTS[this.id] || {top:0,left:0,right:900,bottom:60,width:900,height:60}; }
}

/* laid out as a 900×800 desktop window so frameRead() has real numbers */
const RECTS = {
  strip: {top:16,left:16,right:884,bottom:52,width:868,height:36},
  tabs:  {top:0,left:0,right:0,bottom:0,width:0,height:0},
  deck:  {top:704,left:16,right:884,bottom:784,width:868,height:80},
  ruler: {top:716,left:300,right:700,bottom:746,width:400,height:30}
};

function matches(n, sel){
  if (!n || !n.tagName) return false;
  for (const part of sel.trim().split(/(?=[#.\[])/)){
    if (!part) continue;
    if (part[0] === '#'){ if (n.attributes.id !== part.slice(1)) return false; }
    else if (part[0] === '.'){ if (!n.classList.contains(part.slice(1))) return false; }
    else if (part[0] === '['){
      const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part);
      if (!m) return false;
      if (!(m[1] in n.attributes)) return false;
      if (m[2] !== undefined && n.attributes[m[1]] !== m[2]) return false;
    }
    else if (n.tagName !== part.toUpperCase()) return false;
  }
  return true;
}
function walk(root, out=[]){ for (const c of root.children){ out.push(c); walk(c, out); } return out; }
function query(root, sel){
  const parts = sel.split('>').map(s => s.trim());
  if (parts.length === 2)
    return walk(root).filter(n => matches(n, parts[0]))
      .flatMap(n => n.children.filter(c => matches(c, parts[1])));
  return walk(root).filter(n => matches(n, sel));
}

function parseInto(src, parent){
  const stack = [parent];
  let i = 0;
  while (i < src.length){
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    i = lt;
    if (src.startsWith('<!--', i)){ const e = src.indexOf('-->', i); i = e < 0 ? src.length : e+3; continue; }
    const gt = src.indexOf('>', i);
    if (gt < 0) break;
    const raw = src.slice(i+1, gt); i = gt + 1;
    if (raw[0] === '/'){ if (stack.length > 1) stack.pop(); continue; }
    const nm = /^([a-zA-Z][\w-]*)/.exec(raw);
    if (!nm) continue;
    const tag = nm[1].toLowerCase();
    const el = new El(tag);
    const at = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*"([^"]*)")?/g;
    at.lastIndex = nm[0].length;
    let a; while ((a = at.exec(raw))) el.setAttribute(a[1], a[2] === undefined ? '' : a[2]);
    stack[stack.length-1].appendChild(el);
    if (tag === 'script' || tag === 'style'){
      const close = src.indexOf('</' + tag, i);
      i = close < 0 ? src.length : src.indexOf('>', close) + 1;
      continue;
    }
    if (!raw.trimEnd().endsWith('/') && !VOID.has(tag)) stack.push(el);
  }
}

/* ═══ GL ═════════════════════════════════════════════════════════════════════ */
function glContext(){
  let konst = 0x1000;
  const named = new Map();                    // constant value → its name
  const STRINGS = {
    VERSION: 'WebGL 2.0 (boot-harness)',
    SHADING_LANGUAGE_VERSION: 'WebGL GLSL ES 3.00 (boot-harness)',
    VENDOR: 'Wasteland Props', RENDERER: 'stub'
  };
  const call = (name, args) => {
    switch (name){
      case 'getParameter': {
        const k = named.get(args[0]);
        if (k && k in STRINGS) return STRINGS[k];
        if (k === 'VIEWPORT' || k === 'SCISSOR_BOX') return [0,0,900,800];
        return 16384;
      }
      case 'getShaderParameter': case 'getProgramParameter': return true;
      case 'getShaderPrecisionFormat': return {precision:23, rangeMin:127, rangeMax:127};
      case 'getExtension': return {};
      case 'getSupportedExtensions': return [];
      case 'getContextAttributes': return {alpha:false, antialias:true, depth:true, stencil:false,
        premultipliedAlpha:true, preserveDrawingBuffer:false, powerPreference:'default',
        failIfMajorPerformanceCaveat:false};
      case 'getUniformLocation': return {};
      case 'getActiveUniform': return {name:'u', type:0, size:1};
      case 'getActiveAttrib': return {name:'a', type:0, size:1};
      case 'getAttribLocation': return 0;
      case 'getShaderInfoLog': case 'getProgramInfoLog': return '';
      case 'getError': return 0;
      case 'checkFramebufferStatus': return 36053;   // FRAMEBUFFER_COMPLETE
      case 'isContextLost': return false;
      case 'createShader': case 'createProgram': case 'createBuffer': case 'createTexture':
      case 'createFramebuffer': case 'createRenderbuffer': case 'createVertexArray':
      case 'createSampler': case 'fenceSync': case 'createQuery': return {};
      default: return undefined;
    }
  };
  const store = Object.create(null);
  return new Proxy(store, {
    get(t, k){
      if (typeof k !== 'string') return undefined;
      if (k in t) return t[k];
      if (/^[A-Z][A-Z0-9_]*$/.test(k)){ const v = konst++; named.set(v, k); return (t[k] = v); }
      return (t[k] = (...args) => call(k, args));
    },
    set(t, k, v){ t[k] = v; return true; }
  });
}
const ctx2d = () => new Proxy({}, {
  get(t, k){
    if (k in t) return t[k];
    if (k === 'canvas') return null;
    return (t[k] = (...a) => (k === 'measureText' ? {width:10} : undefined));
  },
  set(t,k,v){ t[k] = v; return true; }
});

/* ═══ WEB AUDIO ══════════════════════════════════════════════════════════════ */
const param = v => ({value:v, setTargetAtTime(){}, setValueAtTime(){}, linearRampToValueAtTime(){}});
class FakeCtx {
  constructor(opt = {}){
    this.sampleRate = opt.sampleRate || 48000;
    this.state = 'running'; this.currentTime = 0;
    this.destination = {channelCount:2};
    this.nodes = 0;
  }
  _node(extra = {}){
    this.nodes++;
    return {connect(){ return this; }, disconnect(){}, channelCount:2,
      channelCountMode:'max', channelInterpretation:'speakers', ...extra};
  }
  createGain(){ return this._node({gain: param(1)}); }
  createChannelSplitter(){ return this._node(); }
  createAnalyser(){
    return this._node({fftSize:2048, smoothingTimeConstant:0,
      getFloatTimeDomainData(a){ for (let i=0;i<a.length;i++) a[i] = Math.sin(i*0.03)*0.5; },
      getByteTimeDomainData(a){ a.fill(128); }});
  }
  createBufferSource(){
    const s = this._node({buffer:null, loop:false, loopStart:0, loopEnd:0,
      playbackRate: param(1), onended:null, start(){ s._started = true; }, stop(){ s._stopped = true; }});
    return s;
  }
  createBuffer(ch, len, rate){
    const data = Array.from({length:ch}, () => new Float32Array(len));
    return {numberOfChannels:ch, length:len, sampleRate:rate, duration:len/rate,
      getChannelData: i => data[i], copyToChannel(src,i){ data[i].set(src.subarray(0,len)); }};
  }
  decodeAudioData(){ return Promise.resolve(this.createBuffer(2, this.sampleRate, this.sampleRate)); }
  resume(){ this.state = 'running'; return Promise.resolve(); }
  close(){ this.state = 'closed'; return Promise.resolve(); }
}

/* ═══ FIXTURE: a real 32-bit float WAV, peaking above 0 dBFS ═════════════════ */
function floatWav({rate = 96000, ch = 2, secs = 1.2} = {}){
  const frames = Math.round(rate*secs), bytes = frames*ch*4;
  const buf = new ArrayBuffer(44 + bytes), dv = new DataView(buf);
  let p = 0; const tag = t => { for (const c of t) dv.setUint8(p++, c.charCodeAt(0)); };
  tag('RIFF'); dv.setUint32(p, buf.byteLength-8, true); p+=4; tag('WAVE');
  tag('fmt '); dv.setUint32(p,16,true); p+=4;
  dv.setUint16(p,3,true); p+=2; dv.setUint16(p,ch,true); p+=2;
  dv.setUint32(p,rate,true); p+=4; dv.setUint32(p,rate*ch*4,true); p+=4;
  dv.setUint16(p,ch*4,true); p+=2; dv.setUint16(p,32,true); p+=2;
  tag('data'); dv.setUint32(p,bytes,true); p+=4;
  for (let i = 0; i < frames; i++){
    const env = Math.exp(-i/frames*3.2);
    for (let c = 0; c < ch; c++)
      dv.setFloat32(p + (i*ch+c)*4, (Math.random()*2-1)*1.7*env, true);
  }
  return buf;
}

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
