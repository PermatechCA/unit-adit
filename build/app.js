import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════════════════════
   UNIT·ADIT — archive access for the Wasteland Props cache library.
   Doctrine: nothing is synthesised here either. Every band of colour on a
   core is measured from the recording itself — RMS sets the diameter,
   spectral centroid sets the mineral, transients set the bedding planes.
   ═══════════════════════════════════════════════════════════════════════ */

const $ = s => document.querySelector(s);
const boot = m => { const e = $('#boot-msg'); if (e) e.textContent = m; };
const clamp = (v,a,b) => v < a ? a : v > b ? b : v;
const lerp = (a,b,t) => a + (b-a) * t;
const pad = (n,w=2) => String(Math.floor(n)).padStart(w,'0');
const dB = v => 20 * Math.log10(Math.max(v, 1e-7));

function clock(sec){
  if (!isFinite(sec)) sec = 0;
  const m = Math.floor(sec/60), s = sec - m*60;
  return pad(m) + ':' + pad(s) + '.' + pad((s % 1) * 1000, 3);
}
function bytes(n){
  if (n < 1024) return n + ' B';
  const u = ['kB','MB','GB']; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < 2);
  return n.toFixed(n < 10 ? 2 : 1) + ' ' + u[i];
}

/* ─── WAV: our own reader ───────────────────────────────────────────────────
   decodeAudioData() silently resamples and, in several browsers, clamps
   32-bit float to ±1.0 — which throws away the headroom that is the whole
   point of shipping float archives. So we parse the container ourselves and
   keep the samples exactly as recorded. Supports PCM 8/16/24/32, IEEE float
   32/64, WAVE_FORMAT_EXTENSIBLE, and RF64 (>4 GB) headers.                */
const FMT = {PCM:1, FLOAT:3, EXT:0xFFFE};

function parseWav(buf){
  const dv = new DataView(buf), len = buf.byteLength;
  const tag = o => String.fromCharCode(dv.getUint8(o),dv.getUint8(o+1),dv.getUint8(o+2),dv.getUint8(o+3));
  const riff = tag(0);
  if (riff !== 'RIFF' && riff !== 'RF64') throw new Error('not a RIFF/RF64 container');
  if (tag(8) !== 'WAVE') throw new Error('RIFF container is not WAVE');

  let p = 12, fmt = null, dataOff = 0, dataLen = 0, ds64 = null, meta = {};
  while (p + 8 <= len){
    const id = tag(p), sz = dv.getUint32(p+4, true), body = p + 8;
    if (id === 'ds64'){
      ds64 = {riff: Number(dv.getBigUint64(body,true)), data: Number(dv.getBigUint64(body+8,true))};
    } else if (id === 'fmt '){
      fmt = {
        code: dv.getUint16(body, true),
        channels: dv.getUint16(body+2, true),
        rate: dv.getUint32(body+4, true),
        bits: dv.getUint16(body+14, true)
      };
      if (fmt.code === FMT.EXT && sz >= 40) fmt.code = dv.getUint16(body+24, true); // SubFormat GUID head
    } else if (id === 'data'){
      dataOff = body;
      dataLen = (sz === 0xFFFFFFFF && ds64) ? ds64.data : sz;
    } else if (id === 'bext' && sz >= 32){
      meta.origin = new TextDecoder().decode(new Uint8Array(buf, body, 32)).replace(/\0+$/,'').trim();
    }
    p = body + sz + (sz & 1);
    if (dataOff && fmt && p >= len) break;
  }
  if (!fmt) throw new Error('no fmt chunk');
  if (!dataOff) throw new Error('no data chunk');
  dataLen = Math.min(dataLen, len - dataOff);

  const {channels:ch, rate, bits} = fmt;
  const bytesPer = bits >> 3, frames = Math.floor(dataLen / (bytesPer * ch));
  if (!frames) throw new Error('data chunk is empty');

  const out = [];
  for (let c = 0; c < ch; c++) out.push(new Float32Array(frames));

  const stride = bytesPer * ch;
  if (fmt.code === FMT.FLOAT && bits === 32 && dataOff % 4 === 0){
    const src = new Float32Array(buf, dataOff, frames*ch);
    for (let c = 0; c < ch; c++){ const o = out[c];
      for (let i = 0, j = c; i < frames; i++, j += ch) o[i] = src[j]; }
  } else if (fmt.code === FMT.PCM && bits === 16 && dataOff % 2 === 0){
    const src = new Int16Array(buf, dataOff, frames*ch), k = 1/32768;
    for (let c = 0; c < ch; c++){ const o = out[c];
      for (let i = 0, j = c; i < frames; i++, j += ch) o[i] = src[j] * k; }
  } else if (fmt.code === FMT.FLOAT && bits === 32){
    for (let c = 0; c < ch; c++){ const o = out[c];
      for (let i = 0, b = dataOff + c*4; i < frames; i++, b += stride) o[i] = dv.getFloat32(b, true); }
  } else if (fmt.code === FMT.FLOAT && bits === 64){
    for (let c = 0; c < ch; c++){ const o = out[c];
      for (let i = 0, b = dataOff + c*8; i < frames; i++, b += stride) o[i] = dv.getFloat64(b, true); }
  } else if (fmt.code === FMT.PCM && bits === 16){
    const k = 1/32768;
    for (let c = 0; c < ch; c++){ const o = out[c];
      for (let i = 0, b = dataOff + c*2; i < frames; i++, b += stride) o[i] = dv.getInt16(b, true) * k; }
  } else if (fmt.code === FMT.PCM && bits === 24){
    const k = 1/8388608;
    for (let c = 0; c < ch; c++){ const o = out[c];
      for (let i = 0, b = dataOff + c*3; i < frames; i++, b += stride){
        const v = dv.getUint8(b) | (dv.getUint8(b+1) << 8) | (dv.getInt8(b+2) << 16);
        o[i] = v * k;
      } }
  } else if (fmt.code === FMT.PCM && bits === 32){
    const k = 1/2147483648;
    for (let c = 0; c < ch; c++){ const o = out[c];
      for (let i = 0, b = dataOff + c*4; i < frames; i++, b += stride) o[i] = dv.getInt32(b, true) * k; }
  } else if (fmt.code === FMT.PCM && bits === 8){
    for (let c = 0; c < ch; c++){ const o = out[c];
      for (let i = 0, b = dataOff + c; i < frames; i++, b += stride) o[i] = (dv.getUint8(b) - 128) / 128; }
  } else {
    throw new Error('unsupported WAV encoding: code ' + fmt.code + ' / ' + bits + '-bit');
  }

  return {
    channels: out, rate, bits, frames,
    encoding: (fmt.code === FMT.FLOAT ? bits + 'F' : bits + 'I'),
    container: riff, meta
  };
}

/* ─── FLAC: header only ────────────────────────────────────────────────────
   We read STREAMINFO so the readout is truthful before a single sample is
   decoded, then hand the bytes to the browser's own FLAC decoder.        */
function parseFlacInfo(buf){
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0x66 || u8[1] !== 0x4C || u8[2] !== 0x61 || u8[3] !== 0x43) return null; // "fLaC"
  if (buf.byteLength < 26) return null;
  const dv = new DataView(buf, 8, 18);
  const a = dv.getUint32(10, false), b = dv.getUint32(14, false);
  return {
    rate: a >>> 12,
    channels: ((a >>> 9) & 7) + 1,
    bits: ((a >>> 4) & 31) + 1,
    frames: ((a & 0xF) * 4294967296) + b, // 36-bit total sample count
    minBlock: dv.getUint16(0, false), maxBlock: dv.getUint16(2, false)
  };
}

/* ─── FFT (iterative radix-2, in place) ─────────────────────────────────── */
function fft(re, im){
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++){
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j){ let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let l = 2; l <= n; l <<= 1){
    const ang = -2 * Math.PI / l, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += l){
      let cr = 1, ci = 0;
      for (let k = 0; k < l/2; k++){
        const ur = re[i+k], ui = im[i+k];
        const vr = re[i+k+l/2]*cr - im[i+k+l/2]*ci;
        const vi = re[i+k+l/2]*ci + im[i+k+l/2]*cr;
        re[i+k] = ur + vr; im[i+k] = ui + vi;
        re[i+k+l/2] = ur - vr; im[i+k+l/2] = ui - vi;
        const ncr = cr*wr - ci*wi; ci = cr*wi + ci*wr; cr = ncr;
      }
    }
  }
}

/* ─── CORE LOG ─────────────────────────────────────────────────────────────
   One pass over the audio produces everything both the geometry and the
   ruler need. SLICES is the vertical resolution of a core; ENV is the
   horizontal resolution of the depth ruler.                              */
const SLICES = 384, ENV = 1400, WIN = 1024, NB = 128;

function logCore(chans, rate, onProgress){
  const n = chans[0].length, nch = chans.length;
  const hop = Math.max(1, Math.floor(n / SLICES));
  const rms = new Float32Array(SLICES), cen = new Float32Array(SLICES), pk = new Float32Array(SLICES);
  const re = new Float32Array(WIN), im = new Float32Array(WIN), win = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) win[i] = 0.5 - 0.5 * Math.cos(2*Math.PI*i/(WIN-1));

  /* log-spaced band edges: the surface is read around the core as frequency,
     so it has to be spaced the way hearing is, not the way an FFT is. */
  const F_LO = 30, F_HI = rate/2, LOG_R = Math.log(F_HI/F_LO);
  const bands = new Float32Array(SLICES*NB), bandHz = new Float32Array(NB);
  const acc = new Float32Array(NB), cnt2 = new Float32Array(NB);
  for (let b = 0; b < NB; b++) bandHz[b] = F_LO*Math.exp(LOG_R*(b+0.5)/NB);
  let bandMax = 1e-9;

  let truePeak = 0;
  for (let s = 0; s < SLICES; s++){
    const start = s * hop, end = Math.min(n, start + hop);
    let sum = 0, peak = 0, cnt = 0;
    for (let i = start; i < end; i++){
      for (let c = 0; c < nch; c++){
        const v = chans[c][i]; sum += v*v; cnt++;
        const a = Math.abs(v); if (a > peak) peak = a;
      }
    }
    rms[s] = cnt ? Math.sqrt(sum/cnt) : 0;
    pk[s] = peak;
    if (peak > truePeak) truePeak = peak;

    re.fill(0); im.fill(0);
    const wStart = Math.min(Math.max(0, start - (WIN>>1)), Math.max(0, n - WIN));
    for (let i = 0; i < WIN && wStart + i < n; i++){
      let m = 0; for (let c = 0; c < nch; c++) m += chans[c][wStart+i];
      re[i] = (m / nch) * win[i];
    }
    fft(re, im);
    let num = 0, den = 0;
    for (let k = 1; k < WIN/2; k++){
      const mag = Math.hypot(re[k], im[k]);
      num += (k * rate / WIN) * mag; den += mag;
    }
    cen[s] = den > 1e-9 ? num/den : 0;

    acc.fill(0); cnt2.fill(0);
    for (let k = 1; k < WIN/2; k++){
      const f = k*rate/WIN;
      if (f < F_LO) continue;
      const b = Math.min(NB-1, Math.floor(NB*Math.log(f/F_LO)/LOG_R));
      acc[b] += Math.hypot(re[k], im[k]); cnt2[b]++;
    }
    const row = s*NB;
    for (let b = 0; b < NB; b++){
      const v = cnt2[b] ? acc[b]/cnt2[b] : 0;
      bands[row+b] = v;
      if (v > bandMax) bandMax = v;
    }
    if (onProgress && (s & 31) === 0) onProgress(s / SLICES);
  }

  // depth-ruler envelope (min/max per bucket, mono sum)
  const eMin = new Float32Array(ENV), eMax = new Float32Array(ENV);
  const eh = Math.max(1, Math.floor(n / ENV));
  for (let e = 0; e < ENV; e++){
    let lo = 0, hi = 0;
    const a = e*eh, b = Math.min(n, a+eh);
    for (let i = a; i < b; i++){
      let m = 0; for (let c = 0; c < nch; c++) m += chans[c][i];
      m /= nch;
      if (m < lo) lo = m; if (m > hi) hi = m;
    }
    eMin[e] = lo; eMax[e] = hi;
  }

  // bedding planes: slices where short-term peak jumps hard against its past
  const bed = new Float32Array(SLICES);
  for (let s = 2; s < SLICES; s++){
    const prev = (pk[s-1] + pk[s-2]) * 0.5 + 1e-6;
    bed[s] = clamp((pk[s] / prev - 1.6) / 3, 0, 1);
  }

  /* to dB against the loudest band in the whole core, then squashed into
     0…1 over 78 dB. Global, not per slice — a quiet passage must LOOK quiet. */
  const iMax = 1/bandMax;
  for (let i = 0; i < bands.length; i++)
    bands[i] = clamp((dB(bands[i]*iMax) + 78)/78, 0, 1);

  let rmsMax = 1e-6; for (let s = 0; s < SLICES; s++) if (rms[s] > rmsMax) rmsMax = rms[s];
  const rmsN = new Float32Array(SLICES);
  for (let s = 0; s < SLICES; s++) rmsN[s] = Math.pow(rms[s]/rmsMax, 0.55);

  return {rms, rmsN, cen, pk, bed, bands, bandHz, eMin, eMax, truePeak, dur: n/rate};
}

/* mineral ramp: spectral centroid → what the band is made of.
   deep oxide (rumble) → ochre (body) → dry ash (air).                     */
const P_RUST = new THREE.Color(0xBD5F35),   // overburden
      P_AMBER = new THREE.Color(0xE7B24C),  // listening
      P_BONE  = new THREE.Color(0xCFC8BC),  // air
      _c = new THREE.Color();
function mineral(hz, energy){
  const t = clamp((Math.log2(Math.max(hz, 30)) - 4.9) / 5.6, 0, 1);  // 30 Hz … ~22 kHz
  if (t < 0.55) _c.copy(P_RUST).lerp(P_AMBER, t/0.55);
  else _c.copy(P_AMBER).lerp(P_BONE, (t-0.55)/0.45);
  return _c.multiplyScalar(0.05 + 0.95*energy);
}

/* ═══ AUDIO ENGINE ═══════════════════════════════════════════════════════ */
const AudioCtor = window.AudioContext || window.webkitAudioContext;

const A = {
  ctx:null, gain:null, split:null, ana:[null,null], src:null,
  buffer:null, offset:0, startedAt:0, playing:false,
  trim:1, native:true, peakHold:[0,0], meterBuf:null
};

function ensureCtx(rate){
  if (A.ctx && A.ctx.sampleRate === rate) return A.ctx;
  if (A.ctx) { try { A.ctx.close(); } catch(e){} }
  let ctx;
  try { ctx = new AudioCtor({sampleRate: rate, latencyHint:'playback'}); }
  catch(e){ ctx = new AudioCtor(); }
  A.native = Math.abs(ctx.sampleRate - rate) < 1;

  const gain = ctx.createGain(); gain.gain.value = A.trim;

  /* up-mix before the split, or a mono core only ever lights the left meter.
     ChannelSplitterNode is fixed at discrete interpretation by spec, so the
     duplication has to happen upstream. */
  const up = ctx.createGain();
  up.channelCount = 2; up.channelCountMode = 'explicit'; up.channelInterpretation = 'speakers';

  const split = ctx.createChannelSplitter(2);
  const anas = [ctx.createAnalyser(), ctx.createAnalyser()];

  /* An AnalyserNode with no outgoing connection is a terminal node. Chrome
     keeps a list of automatic-pull nodes and processes it anyway; WebKit does
     not, so on iOS the analysers never ran and the meters sat flat at −∞.
     Route them into a muted sink that reaches the destination. */
  const sink = ctx.createGain(); sink.gain.value = 0;

  anas.forEach((an,i) => {
    an.fftSize = 2048; an.smoothingTimeConstant = 0;
    split.connect(an, i); an.connect(sink);
  });

  gain.connect(up); up.connect(split);
  sink.connect(ctx.destination);
  gain.connect(ctx.destination);

  A.ctx = ctx; A.gain = gain; A.split = split; A.ana = anas; A.sink = sink;
  A.meterBuf = new Float32Array(2048);
  A.byteBuf = null;
  return ctx;
}

function stopSource(){
  if (A.src){ try { A.src.onended = null; A.src.stop(); } catch(e){} A.src = null; }
}

function position(){
  if (!A.buffer) return 0;
  let t = A.playing ? A.offset + (A.ctx.currentTime - A.startedAt) : A.offset;
  if (A.src && A.src.loop){
    const a = A.src.loopEnd > A.src.loopStart ? A.src.loopStart : 0;
    const b = A.src.loopEnd > A.src.loopStart ? A.src.loopEnd : A.buffer.duration;
    if (t > b && b > a) t = a + ((t - a) % (b - a));
  }
  return clamp(t, 0, A.buffer.duration);
}

function play(){
  if (!A.buffer || A.playing) return;
  if (A.ctx.state === 'suspended') A.ctx.resume();
  if (A.offset >= A.buffer.duration - 0.002) A.offset = 0;
  const s = A.ctx.createBufferSource();
  s.buffer = A.buffer; s.connect(A.gain);
  s.loop = (S.mode === 'one');
  if (S.rgnA != null && S.rgnB > S.rgnA){
    s.loopStart = S.rgnA; s.loopEnd = S.rgnB;
    if (A.offset < S.rgnA - 0.001 || A.offset > S.rgnB) A.offset = S.rgnA;
  }
  s.onended = () => { if (A.src === s && !s.loop) endOfCore(); };
  s.start(0, A.offset);
  A.src = s; A.startedAt = A.ctx.currentTime; A.playing = true;
  UI.transport();
}
function pause(){
  if (!A.playing) return;
  A.offset = position(); stopSource(); A.playing = false; UI.transport();
}
function stop(){
  stopSource(); A.playing = false;
  A.offset = S.rgnA != null ? S.rgnA : 0; A.peakHold = [0,0]; UI.transport();
}

/* Reached the end of the core, or the end of the marked region. */
function endOfCore(){
  if (S.mode === 'chain'){
    const nx = neighbour(1);
    if (nx >= 0){ selectEntry(nx); return; }
  }
  stopSource(); A.playing = false;
  A.offset = (S.rgnB != null) ? S.rgnB : A.buffer.duration;
  UI.transport();
}
function seek(t){
  if (!A.buffer) return;
  const was = A.playing;
  stopSource(); A.playing = false;
  A.offset = clamp(t, 0, A.buffer.duration);
  if (was) play(); else UI.transport();
}
function setTrim(db){
  A.trim = Math.pow(10, db/20);
  if (A.gain) A.gain.gain.setTargetAtTime(A.trim, A.ctx.currentTime, 0.01);
}

/* peak per channel, read post-trim so the meter shows what leaves the deck */
function meters(){
  if (!A.ana[0]) return [0,0];
  const out = [0,0];
  for (let c = 0; c < 2; c++){
    const an = A.ana[c];
    if (an.getFloatTimeDomainData){
      an.getFloatTimeDomainData(A.meterBuf);
      let p = 0;
      for (let i = 0; i < A.meterBuf.length; i += 2){ const a = Math.abs(A.meterBuf[i]); if (a > p) p = a; }
      out[c] = p;
    } else {
      // pre-14.1 Safari: byte domain only, so anything over 0 dBFS reads as 0
      if (!A.byteBuf) A.byteBuf = new Uint8Array(2048);
      an.getByteTimeDomainData(A.byteBuf);
      let p = 0;
      for (let i = 0; i < A.byteBuf.length; i += 2){
        const a = Math.abs(A.byteBuf[i] - 128) / 128; if (a > p) p = a;
      }
      out[c] = p;
    }
  }
  return out;
}

/* ═══ LOADING ════════════════════════════════════════════════════════════ */
function sniff(buf){
  const u = new Uint8Array(buf, 0, Math.min(12, buf.byteLength));
  const s = String.fromCharCode(...u);
  if (s.startsWith('RIFF') || s.startsWith('RF64')) return 'wav';
  if (s.startsWith('fLaC')) return 'flac';
  if (s.startsWith('OggS')) return 'ogg';
  if (s.startsWith('ID3') || (u[0] === 0xFF && (u[1] & 0xE0) === 0xE0)) return 'mp3';
  return 'unknown';
}

async function decode(buf, name){
  const kind = sniff(buf);

  if (kind === 'wav'){
    const w = parseWav(buf);                       // exact samples, no clamp
    const ctx = ensureCtx(w.rate);
    const ab = ctx.createBuffer(w.channels.length, w.frames, w.rate);
    for (let c = 0; c < w.channels.length; c++) ab.copyToChannel(w.channels[c], c);
    return {ab, chans: w.channels, rate: w.rate, encoding: w.encoding,
            container: w.container === 'RF64' ? 'RF64' : 'WAV', meta: w.meta};
  }

  const info = kind === 'flac' ? parseFlacInfo(buf) : null;
  const ctx = ensureCtx(info ? info.rate : 48000);
  const ab = await ctx.decodeAudioData(buf.slice(0));
  const chans = [];
  for (let c = 0; c < ab.numberOfChannels; c++) chans.push(ab.getChannelData(c));
  return {
    ab, chans, rate: ab.sampleRate,
    encoding: info ? info.bits + 'I' : '32F',
    container: kind.toUpperCase(),
    meta: {},
    note: kind === 'flac' ? null : 'lossy source'
  };
}

/* ═══ STATE ══════════════════════════════════════════════════════════════ */
const S = {
  entries: [], current: -1, seam: 'ALL', query: '', collection: '—',
  hover: -1, view: 'read', busy: false,
  mode: 'off',          // off → one (loop) → chain (auto-advance)
  rgnA: null, rgnB: null
};

const esc = t => String(t).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* The archive is a shelf, not a workshop. Reading a local file is a bench tool
   for whoever maintains it, so it lives behind ?log and is invisible otherwise. */
const LOG_MODE = new URLSearchParams(location.search).has('log');

const nameFrom = (u, fallback) => {
  try { return decodeURIComponent(new URL(u, location.href).pathname.split('/').pop()) || fallback; }
  catch(_){ return String(fallback).replace(/[^\w.-]+/g,'_'); }
};
const nameOf   = e => e.file ? e.file.name : nameFrom(e.url, e.title);
/* FLAC streams because it is half the weight; the download is the float master
   when there is one, since FLAC is integer-only and cannot carry the headroom. */
const srcOf    = e => e.masterUrl || e.url;
const dlNameOf = e => e.file ? e.file.name : nameFrom(srcOf(e), e.title);
const extOf = e => { const m = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(nameOf(e)); return m ? m[1].toUpperCase() : '—'; };
const masterExtOf = e => e.masterUrl ? (/\.([a-z0-9]{2,5})(?:\?|$)/i.exec(dlNameOf(e))||[,'—'])[1].toUpperCase() : null;

/* ═══ SCENE — THE SCAN ═══════════════════════════════════════════════════════
   Nothing in here is lit. A solid, lit, radially displaced cylinder with brown
   noise and bedding rings is a tree trunk; LATHE made that mistake once and
   diagnosed it properly, so ADIT does not get to make it again.

   The unit is an instrument, so it renders MEASUREMENT, not matter. Every ring
   is one time slice's spectrum wrapped exactly once around the turn — emissive
   traces, additively blended, bloomed, hanging in a grid void with nothing
   shading them. Down the core is time. Around the core is frequency, log
   spaced. A tonal recording grows vertical ridges you can read across a room;
   broadband noise rings evenly; a gated silence pinches to a wire.

   Five passes: scene → bright → blur H → blur V → composite.
   ═══════════════════════════════════════════════════════════════════════════ */
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COL_H = 5.4, COL_X = 0.95, R0 = 0.30, RM = 0.40, TAU = Math.PI*2;

const renderer = new THREE.WebGLRenderer({antialias:true, powerPreference:'high-performance', alpha:false});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;   // the shoulder lives in the composite
renderer.autoClear = true;
document.body.insertBefore(renderer.domElement, document.body.firstChild);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x07060a, 0.055);
const camera = new THREE.PerspectiveCamera(34, innerWidth/innerHeight, 0.1, 200);
camera.position.set(3.0, 0.95, 6.5);

const camPos = camera.position.clone(), camAim = new THREE.Vector3(0.55, 0, 0);
const wantPos = camPos.clone(), wantAim = camAim.clone();
const VIEWS = {
  read: {p:new THREE.Vector3(3.0,0.95,6.5),  a:new THREE.Vector3(0.55,0,0)},
  rack: {p:new THREE.Vector3(-0.6,1.5,2.6),  a:new THREE.Vector3(-1.0,0.6,-6.5)}
};

const TOUCH = matchMedia('(pointer:coarse)').matches;
const PHONE = matchMedia('(max-width:700px)').matches;
const PARALLAX = TOUCH ? 0 : 1;      // no cursor to follow, so no drift
if (PHONE){
  camera.fov = 42; camera.updateProjectionMatrix();
  VIEWS.rack.p.set(-0.4,1.9,3.6);  VIEWS.rack.a.set(-1.0,0.9,-6.5);
}
if (TOUCH) renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));

/* additive trace material — the house style for everything in the void */
const trace = (o) => new THREE.LineBasicMaterial(Object.assign({
  transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, fog:true
}, o));

/* ─ the void has a floor only because a survey needs a datum ─ */
let gridMesh;
{
  const v = [], c = [], EXT = 44;
  const dim = new THREE.Color(0x241a14), lit = new THREE.Color(0x4c3828);
  const seg = (x1,z1,x2,z2,col) => { v.push(x1,0,z1,x2,0,z2);
    c.push(col.r,col.g,col.b,col.r,col.g,col.b); };
  for (let i = -EXT; i <= EXT; i += 5){ seg(-EXT,i,EXT,i,lit); seg(i,-EXT,i,EXT,lit); }
  for (let i = -18; i <= 18; i++) if (i % 5) { seg(-18,i,18,i,dim); seg(i,-18,i,18,dim); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v,3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c,3));
  gridMesh = new THREE.LineSegments(g, trace({vertexColors:true, opacity:0.85}));
  scene.add(gridMesh);
}

/* ─ the read head: cradle rings and a depth rail, drawn as bone hairlines ─ */
const head = new THREE.Group(); head.position.x = COL_X; scene.add(head);

function ringGeo(r, n){
  const p = []; for (let i = 0; i <= n; i++){ const t = i/n*TAU; p.push(Math.cos(t)*r, 0, Math.sin(t)*r); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p,3));
  return g;
}
for (const y of [COL_H/2 + 0.10, -COL_H/2 - 0.10]){
  const l = new THREE.Line(ringGeo(R0+RM+0.16, 96), trace({color:0xCFC8BC, opacity:0.22}));
  l.position.y = y; head.add(l);
}
{
  const v = [], x = R0+RM+0.34;
  v.push(x,-COL_H/2,0, x,COL_H/2,0);
  for (let i = 0; i <= 20; i++){
    const y = COL_H/2 - (i/20)*COL_H, w = (i % 2 === 0) ? 0.14 : 0.07;
    v.push(x,y,0, x+w,y,0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v,3));
  head.add(new THREE.LineSegments(g, trace({color:0xCFC8BC, opacity:0.20})));
}

/* ─ the specimen ─────────────────────────────────────────────────────────────
   One indexed point cloud: SLICES × NB vertices. Rings index around it, ribs
   index down it. Two index ranges, one buffer, one draw call.               */
let coreLines = null, pickMesh = null;

function buildCore(log){
  if (coreLines){ head.remove(coreLines); coreLines.geometry.dispose(); coreLines = null; }
  if (pickMesh){ head.remove(pickMesh); pickMesh.geometry.dispose(); pickMesh = null; }

  const N = SLICES, B = NB, bands = log.bands, freqs = log.bandHz;
  const pos = new Float32Array(N*B*3), col = new Float32Array(N*B*3);
  const cosT = new Float32Array(B), sinT = new Float32Array(B);
  for (let b = 0; b < B; b++){ const t = b/B*TAU; cosT[b] = Math.cos(t); sinT[b] = Math.sin(t); }

  for (let s = 0; s < N; s++){
    const y = COL_H/2 - (s/(N-1))*COL_H, row = s*B;
    for (let b = 0; b < B; b++){
      const v = bands[row+b], r = R0 + RM*v, i = (row+b)*3;
      pos[i] = cosT[b]*r; pos[i+1] = y; pos[i+2] = sinT[b]*r;
      const c = mineral(freqs[b], v*v*0.85 + v*0.15);
      col[i] = c.r; col[i+1] = c.g; col[i+2] = c.b;
    }
  }

  const RIB = 16, ribStep = Math.max(1, B/RIB)|0;
  const idx = new Uint32Array(N*B*2 + (N-1)*RIB*2);
  let k = 0;
  for (let s = 0; s < N; s++){ const row = s*B;
    for (let b = 0; b < B; b++){ idx[k++] = row+b; idx[k++] = row + ((b+1) % B); } }
  for (let b = 0; b < B; b += ribStep){
    for (let s = 0; s < N-1; s++){ idx[k++] = s*B+b; idx[k++] = (s+1)*B+b; } }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  g.setAttribute('color', new THREE.BufferAttribute(col,3));
  g.setIndex(new THREE.BufferAttribute(idx.subarray(0,k),1));
  coreLines = new THREE.LineSegments(g, trace({vertexColors:true, opacity:0.62, depthTest:false}));
  coreLines.renderOrder = 2;
  head.add(coreLines);

  // invisible material, still raycastable — this is what you drag to seek
  const grab = (R0 + RM) * (TOUCH ? 2.4 : 1.5);
  pickMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(grab, grab, COL_H * 1.04, 20, 1, true),
    new THREE.MeshBasicMaterial({visible:false, side:THREE.DoubleSide}));
  head.add(pickMesh);
}

/* ─ the tool: a live spectrum trace at the playhead, and the ring it rides ─ */
const liveGeo = new THREE.BufferGeometry();
liveGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NB*3),3));
const liveTrace = new THREE.LineLoop(liveGeo,
  trace({color:0x9FF0D6, opacity:1.0, depthTest:false, fog:false}));
liveTrace.renderOrder = 3;

const toolRing = new THREE.Line(ringGeo(R0+RM+0.16, 128),
  trace({color:0x82BBA8, opacity:0.9, depthTest:false, fog:false}));
toolRing.renderOrder = 3;

const scan = new THREE.Group();
scan.add(liveTrace, toolRing);
scan.visible = false;
head.add(scan);

/* ─ rack: the rest of the archive, racked in the dark ─ */
const rackGeo = new THREE.CylinderGeometry(0.085, 0.085, 1.0, 8, 1);
rackGeo.rotateZ(Math.PI/2);
const rackMat = new THREE.MeshBasicMaterial({
  transparent:true, opacity:0.55, blending:THREE.AdditiveBlending, depthWrite:false, fog:true});
const RACK_MAX = 256;
const rack = new THREE.InstancedMesh(rackGeo, rackMat, RACK_MAX);
rack.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
rack.count = 0;
rack.position.set(-2.9, -0.3, -6.2);
scene.add(rack);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1,1,1);
const rackHome = [];

function hash1(n){ const s = Math.sin(n)*43758.5453; return s - Math.floor(s); }

function layoutRack(n){
  rack.count = Math.min(n, RACK_MAX);
  rackHome.length = 0;
  const COLS = 7;
  for (let i = 0; i < rack.count; i++){
    const c = i % COLS, r = Math.floor(i / COLS);
    const p = new THREE.Vector3(c*1.22 + hash1(i)*0.05, -r*0.42, -Math.floor(r/6)*0.9 + hash1(i*3)*0.04);
    rackHome.push(p);
    _q.setFromEuler(new THREE.Euler(0, 0, (hash1(i*7)-0.5)*0.06));
    _m.compose(p, _q, _s);
    rack.setMatrixAt(i, _m);
    rack.setColorAt(i, new THREE.Color(0x2e2018).lerp(new THREE.Color(0x7a4b2a), hash1(i*11)*0.5));
  }
  rack.instanceMatrix.needsUpdate = true;
  if (rack.instanceColor) rack.instanceColor.needsUpdate = true;
}
function tintRack(i, col){
  if (i < 0 || i >= rack.count) return;
  rack.setColorAt(i, col);
  if (rack.instanceColor) rack.instanceColor.needsUpdate = true;
}

/* ─ suspended dust. the only thing in here that is matter ─ */
const DUST = TOUCH ? 340 : 700;
const dpos = new Float32Array(DUST*3), dseed = new Float32Array(DUST);
for (let i = 0; i < DUST; i++){
  const a = Math.random()*TAU, r = 0.5 + Math.random()*4.2;
  dpos[i*3] = Math.cos(a)*r; dpos[i*3+1] = (Math.random()-0.5)*7.5; dpos[i*3+2] = Math.sin(a)*r;
  dseed[i] = Math.random();
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos,3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
  color:0xE7B24C, size:0.013, sizeAttenuation:true, transparent:true, opacity:0.30,
  blending:THREE.AdditiveBlending, depthWrite:false, fog:true}));
const dustGrp = new THREE.Group(); dustGrp.position.x = COL_X; dustGrp.add(dust); scene.add(dustGrp);

/* ═══ FIVE-PASS COMPOSITE ═══════════════════════════════════════════════════ */
let POST = true;
const rtScene = new THREE.WebGLRenderTarget(1,1,{samples:4});
const rtBright = new THREE.WebGLRenderTarget(1,1);
const rtBlurA  = new THREE.WebGLRenderTarget(1,1);
const rtBlurB  = new THREE.WebGLRenderTarget(1,1);
for (const t of [rtScene, rtBright, rtBlurA, rtBlurB]) t.texture.colorSpace = THREE.SRGBColorSpace;

const QUAD_VS = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }';

const brightMat = new THREE.ShaderMaterial({
  uniforms:{tD:{value:rtScene.texture}, uCut:{value:0.34}},
  vertexShader:QUAD_VS,
  fragmentShader:`varying vec2 vUv; uniform sampler2D tD; uniform float uCut;
    void main(){ vec3 c=texture2D(tD,vUv).rgb;
      float l=dot(c,vec3(.2126,.7152,.0722));
      gl_FragColor=vec4(c*smoothstep(uCut,uCut+0.28,l),1.0); }`
});

const blurMat = new THREE.ShaderMaterial({
  uniforms:{tD:{value:null}, uDir:{value:new THREE.Vector2(1,0)}},
  vertexShader:QUAD_VS,
  fragmentShader:`varying vec2 vUv; uniform sampler2D tD; uniform vec2 uDir;
    void main(){
      vec3 s = texture2D(tD,vUv).rgb*0.2270270;
      s += (texture2D(tD,vUv+uDir*1.3846).rgb + texture2D(tD,vUv-uDir*1.3846).rgb)*0.3162162;
      s += (texture2D(tD,vUv+uDir*3.2307).rgb + texture2D(tD,vUv-uDir*3.2307).rgb)*0.0702702;
      gl_FragColor=vec4(s,1.0); }`
});

const postMat = new THREE.ShaderMaterial({
  uniforms:{tD:{value:rtScene.texture}, tB:{value:rtBlurB.texture},
            uT:{value:0}, uRes:{value:new THREE.Vector2(1,1)}, uAmt:{value:1}},
  vertexShader:QUAD_VS,
  fragmentShader:`
    varying vec2 vUv; uniform sampler2D tD,tB; uniform float uT,uAmt; uniform vec2 uRes;
    float n(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 uv=vUv, d=uv-0.5; float r2=dot(d,d);
      vec2 off=d*r2*0.020*uAmt;              // only the outer frame bends
      vec3 c;
      c.r=texture2D(tD,uv-off*1.08).r;
      c.g=texture2D(tD,uv-off).g;
      c.b=texture2D(tD,uv-off*0.92).b;
      c += texture2D(tB,uv).rgb*0.95;        // bloom
      c *= 1.0-r2*0.68*uAmt;                 // vignette
      c += (n(floor(uv*uRes/1.5)+fract(uT))-0.5)*0.030*uAmt;
      c *= 1.0-0.020*uAmt*sin(uv.y*uRes.y*1.5708);
      c = c/(c*0.78+0.24);                   // shoulder, so traces never go flat white
      gl_FragColor=vec4(max(c,0.0),1.0);
    }`
});

const quad = new THREE.Mesh(new THREE.PlaneGeometry(2,2), postMat);
const postScene = new THREE.Scene(); postScene.add(quad);
const postCam = new THREE.OrthographicCamera(-1,1,1,-1,0,1);

function pass(mat, target){
  quad.material = mat;
  renderer.setRenderTarget(target);
  renderer.render(postScene, postCam);
}

/* ─ FRAMING ─────────────────────────────────────────────────────────────────
   The HUD covers the top and bottom of the screen, so framing to the viewport
   puts the ends of the core underneath the chrome — badly on a phone, subtly
   on a laptop. Measure the band the panels actually leave, then scale the
   specimen to fill it and shift the aim so its centre lands in the middle of
   that band. Scale rather than dolly: pushing the camera back to fit would
   drag the core into the fog.                                              */
const CORE_SPAN = COL_H + 0.7;
const READ_DIR = new THREE.Vector3(PHONE ? 0.22 : 0.30, PHONE ? 0.10 : 0.13, 1).normalize();

function frameRead(){
  const H = Math.max(1, innerHeight);
  const shown = n => n && getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().height > 0;
  const tabs = document.getElementById('tabs'), strip = document.getElementById('strip'),
        deck = document.getElementById('deck');
  let top = 0, bot = H;
  if (shown(tabs)) top = tabs.getBoundingClientRect().bottom;
  else if (shown(strip)) top = strip.getBoundingClientRect().bottom;
  if (shown(deck)) bot = deck.getBoundingClientRect().top;
  top += 14; bot -= 14;
  if (bot - top < 90){ top = 0; bot = H; }          // degenerate window: take the lot

  const band = clamp((bot - top) / H, 0.15, 1);     // share of viewport we own
  const fc = ((top + bot) * 0.5) / H;               // and where its centre sits
  const d = PHONE ? 8.4 : 7.4;
  const tanH = Math.tan(camera.fov * Math.PI / 360);
  const Vh = 2 * d * tanH;

  const k = clamp((band * Vh) / CORE_SPAN, 0.2, 1.3);
  head.scale.setScalar(k);
  dustGrp.scale.setScalar(k);
  gridMesh.position.y = -(COL_H/2 + 0.55) * k;

  VIEWS.read.a.set(PHONE ? COL_X : COL_X - 0.40, (fc - 0.5) * Vh, 0);
  VIEWS.read.p.copy(READ_DIR).multiplyScalar(d).add(VIEWS.read.a);
  if (S.view === 'read'){ wantPos.copy(VIEWS.read.p); wantAim.copy(VIEWS.read.a); }
}

function resize(){
  const w = innerWidth, h = innerHeight;
  const dpr = TOUCH ? Math.min(devicePixelRatio,1.75) : Math.min(devicePixelRatio,2);
  renderer.setPixelRatio(TOUCH ? Math.min(dpr,1.75) : dpr); renderer.setSize(w,h,false);
  camera.aspect = w/h; camera.updateProjectionMatrix();
  const W = Math.floor(w*dpr), H = Math.floor(h*dpr);
  rtScene.setSize(W,H);
  const bw = Math.max(2, W>>1), bh = Math.max(2, H>>1);
  rtBright.setSize(bw,bh); rtBlurA.setSize(bw,bh); rtBlurB.setSize(bw,bh);
  postMat.uniforms.uRes.value.set(W,H);
  frameRead();
  UI.ruler();
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 250));
// iOS shrinks and grows the toolbar without firing a window resize
if (window.visualViewport) visualViewport.addEventListener('resize', resize);

/* ═══ HUD ════════════════════════════════════════════════════════════════ */
function filtered(){
  const q = S.query;
  return S.entries.map((e,i) => ({e,i})).filter(({e}) =>
    (S.seam === 'ALL' || (e.tags||[]).includes(S.seam)) &&
    (!q || (e.title + ' ' + (e.tags||[]).join(' ') + ' ' + (e.notes||'') + ' ' + (e.id||''))
            .toLowerCase().includes(q)));
}
function neighbour(d){
  const list = filtered().map(x => x.i);
  const at = list.indexOf(S.current);
  if (at < 0) return list.length ? list[0] : -1;
  const nx = at + d;
  return (nx >= 0 && nx < list.length) ? list[nx] : -1;
}

const DB_TOP = 12, DB_BOT = -60, DB_SPAN = DB_TOP - DB_BOT;
const dbY = d => (1 - (clamp(d, DB_BOT, DB_TOP) - DB_BOT) / DB_SPAN) * 100;

const el = {
  rows:$('#rows'), filter:$('#filter'), ruler:$('#ruler'), env:$('#env'), ticks:$('#ticks'),
  headline:$('#head'), played:$('#played'), pos:$('#c-pos'), len:$('#c-len'),
  play:$('#k-play'), loop:$('#k-loop'), state:$('#s-state'), fmt:$('#s-fmt'), rate:$('#s-rate'),
  ctx:$('#s-ctx'), tp:$('#s-tp'), coll:$('#s-coll'), count:$('#s-count'), hint:$('#s-hint'),
  stamp:$('#stamp'), stTitle:$('#st-title'), stMeta:$('#st-meta'), label:$('#label'),
  gain:$('#gain'), cgain:$('#c-gain'), barL:$('#bar-l'), barR:$('#bar-r'), scale:$('#scale'),
  search:$('#search'), dl:$('#k-dl'), link:$('#k-link'), zone:$('#loopzone'), rgn:$('#rgn'), mm:[$('#mm-l > u'), $('#mm-r > u')], tabs:$('#tabs')
};
const ictx = el.env.getContext('2d');
const PLAY_ICON = '<svg viewBox="0 0 16 16"><path d="M4 3l9 5-9 5z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 16 16"><path d="M4 3h3v10H4zm5 0h3v10H9z"/></svg>';

const UI = {
  scale(){
    el.scale.innerHTML = [0,-6,-12,-18,-24,-36,-48].map(d =>
      `<i style="top:${dbY(d)}%">${d===0?'  0':d}</i>`).join('');
    for (const b of [el.barL, el.barR]) b.querySelector('.over').style.height = dbY(0) + '%';
  },

  filters(){
    const seams = ['ALL', ...new Set(S.entries.flatMap(e => e.tags || []))].slice(0, 5);
    el.filter.innerHTML = seams.map(s =>
      `<button type="button" data-seam="${s}" aria-pressed="${s===S.seam}">${s}</button>`).join('');
  },

  rows(){
    const q = S.query;
    const list = filtered();
    el.count.textContent = (q || S.seam !== 'ALL')
      ? pad(list.length,3) + '/' + pad(S.entries.length,3) : pad(S.entries.length,3);
    if (!list.length){
      el.rows.innerHTML = `<div class="row" style="cursor:default"><span class="n">···</span>
        <span class="c"><span class="t" style="color:var(--ash)">${S.entries.length ? 'No core matches that' : 'Nothing logged yet'}</span></span>
        <span class="d"></span><span></span></div>`;
      return;
    }
    el.rows.innerHTML = list.map(({e,i}) => {
      const mx = masterExtOf(e);
      const meta = [(e.tags||[]).join(' · ') || (e.local ? 'LOCAL' : 'CACHE'),
                    e.badge || extOf(e),
                    e.size ? bytes(e.size) : null,
                    mx ? '↓ ' + mx : null].filter(Boolean).join('  ·  ');
      return `<div class="row${e.failed?' bad':''}" role="option" tabindex="0" data-i="${i}"
            aria-current="${i===S.current}" aria-selected="${i===S.current}">
         <span class="n">${pad(i+1,3)}</span>
         <span class="c"><span class="t">${esc(e.title)}</span><span class="tag">${esc(meta)}</span></span>
         <span class="d">${e.dur ? clock(e.dur).slice(0,5) : (e.failed ? 'ERR' : '––:––')}</span>
         <button class="dl" type="button" data-dl="${i}" title="Download ${esc(dlNameOf(e))}"
                 aria-label="Download ${esc(e.title)}">↓</button>
       </div>`; }).join('');
  },

  region(){
    const on = S.rgnA != null && S.rgnB > S.rgnA && A.buffer;
    el.zone.style.display = on ? 'block' : 'none';
    if (on){
      const d = A.buffer.duration;
      el.zone.style.left = (S.rgnA/d*100) + '%';
      el.zone.style.width = ((S.rgnB - S.rgnA)/d*100) + '%';
      el.rgn.textContent = 'A/B ' + clock(S.rgnA).slice(0,8) + '–' + clock(S.rgnB).slice(0,8);
    } else el.rgn.textContent = '';
  },

  mode(){
    const on = S.mode !== 'off';
    el.loop.setAttribute('aria-pressed', String(on));
    el.loop.innerHTML = S.mode === 'chain'
      ? '<svg viewBox="0 0 16 16"><path d="M8 1l3 3H9v4H7V4H5zm0 14l-3-3h2V8h2v4h2z"/></svg>'
      : '<svg viewBox="0 0 16 16"><path d="M3 5h8V3l3 3-3 3V7H4v3H2V6a1 1 0 011-1zm10 6H5v2l-3-3 3-3v2h9v4h-2z"/></svg>';
    el.loop.title = S.mode === 'off' ? 'Play once — L'
      : S.mode === 'one' ? 'Loop this core — L' : 'Chain through the log — L';
    el.loop.setAttribute('aria-label', el.loop.title.replace(' — L',''));
    if (A.src) A.src.loop = (S.mode === 'one');
  },

  transport(){
    const has = !!A.buffer;
    el.play.innerHTML = A.playing ? PAUSE_ICON : PLAY_ICON;
    el.play.setAttribute('aria-label', A.playing ? 'Pause' : 'Play');
    el.play.disabled = !has;
    el.state.textContent = S.busy ? 'LOGGING' : A.playing ? 'READING' : has ? 'HELD' : 'IDLE';
    el.link.disabled = !has;
    el.len.textContent = clock(has ? A.buffer.duration : 0);
    scan.visible = has;
  },

  ruler(){
    const e = S.entries[S.current];
    const w = el.ruler.clientWidth, h = el.ruler.clientHeight, dpr = Math.min(devicePixelRatio,2);
    if (!w || !h) return;
    el.env.width = w*dpr; el.env.height = h*dpr;
    ictx.setTransform(dpr,0,0,dpr,0,0);
    ictx.clearRect(0,0,w,h);
    if (e && e.log){
      const {eMin, eMax} = e.log, mid = h/2;
      ictx.fillStyle = 'rgba(221,213,198,.42)';
      for (let x = 0; x < w; x++){
        const i = Math.floor(x / w * ENV);
        const hi = clamp(eMax[i],-1,1), lo = clamp(eMin[i],-1,1);
        const y0 = mid - hi*mid*0.92, y1 = mid - lo*mid*0.92;
        ictx.fillRect(x, y0, 1, Math.max(1, y1-y0));
      }
    }
    // depth ticks
    const dur = A.buffer ? A.buffer.duration : 0;
    if (dur > 0){
      const step = dur > 600 ? 120 : dur > 240 ? 60 : dur > 90 ? 30 : dur > 30 ? 10 : dur > 10 ? 5 : 1;
      let html = '';
      for (let t = step; t < dur; t += step){
        const p = t/dur*100, maj = (t % (step*5) === 0);
        html += `<u class="${maj?'maj':''}" style="left:${p}%" data-l="${maj?clock(t).slice(0,5):''}"></u>`;
      }
      el.ticks.innerHTML = html;
    } else el.ticks.innerHTML = '';
  },

  stamp(e){
    if (!e){
      el.stamp.className = 'on';
      el.stTitle.textContent = S.entries.length ? 'Select a core'
        : LOG_MODE ? 'No manifest loaded' : 'Archive unavailable';
      el.stMeta.innerHTML = S.entries.length
        ? 'Pick a line from the core log to read it. Everything here can be taken away with it.'
        : LOG_MODE
          ? 'Drop a WAV or FLAC anywhere on this page to log it as a core.<br>Nothing is uploaded — decoding happens in this browser.'
          : 'The archive manifest could not be read. Try again shortly.';
      return;
    }
    el.stamp.className = 'on side';
    el.stTitle.textContent = e.title;
    const bits = [];
    if (e.loc) bits.push('SITE ' + e.loc);
    if (e.date) bits.push('LOGGED ' + e.date);
    if (e.size) bits.push('RECOVERY ' + bytes(e.size));
    el.stMeta.innerHTML =
      (e.notes ? e.notes + '<br>' : '') +
      `<span style="color:var(--ash-lo)">${bits.join('  ·  ')}</span>` +
      (e.license ? `<br><span style="color:var(--ash-lo)">USE ${e.license}</span>` : '');
  },

  frame(){
    const has = !!A.buffer;
    const p = position(), dur = has ? A.buffer.duration : 1;
    const f = has ? clamp(p/dur, 0, 1) : 0;
    el.pos.textContent = clock(p);
    el.headline.style.left = (f*100) + '%';
    if (el.played) el.played.style.width = (f*100) + '%';
    el.ruler.setAttribute('aria-valuenow', Math.round(f*100));

    const m = meters();
    const bars = [el.barL, el.barR];
    for (let c = 0; c < 2; c++){
      const d = dB(m[c]);
      A.peakHold[c] = Math.max(m[c], A.peakHold[c] * 0.982);
      const lvl = bars[c].querySelector('.lvl'), pk = bars[c].querySelector('.pk');
      lvl.style.height = (100 - dbY(d)) + '%';
      pk.style.bottom = (100 - dbY(dB(A.peakHold[c]))) + '%';
      bars[c].classList.toggle('clip', m[c] > 1.0);
      if (el.mm[c]) el.mm[c].style.width = (100 - dbY(d)) + '%';
    }
    return f;
  }
};

/* ═══ SELECTION & LOADING ════════════════════════════════════════════════ */
async function bytesFor(e){
  if (e.file) return {buf: await e.file.arrayBuffer(), size: e.file.size};
  if (e.raw) return {buf: e.raw, size: e.raw.byteLength};
  const r = await fetch(e.url, {mode:'cors'});
  if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + e.url);
  const buf = await r.arrayBuffer();
  return {buf, size: buf.byteLength};
}

/* Pull the next core's bytes while this one plays, so chaining is seamless. */
async function prefetch(i){
  const e = S.entries[i];
  if (!e || e.file || e.raw || e.decoded || e.failed) return;
  const c = navigator.connection;
  if (c && (c.saveData || /^([23]g|slow-2g)$/.test(c.effectiveType || ''))) return;
  try {
    const r = await fetch(e.url, {mode:'cors'});
    if (r.ok){ e.raw = await r.arrayBuffer(); e.size = e.raw.byteLength; UI.rows(); }
  } catch(_){ /* a failed prefetch is not an error the reader needs to see */ }
}

/* Decoded 32-bit float is roughly 4× the file on disk. Keep the last few and
   let the rest go — reselecting re-reads, which is cheap next to an OOM. */
const KEEP_DECODED = 5, KEEP_RAW = 3;
function evict(){
  const byAge = f => S.entries.map((e,i) => ({e,i})).filter(x => f(x.e))
    .sort((a,b) => (b.e.touched||0) - (a.e.touched||0));
  byAge(e => e.decoded).slice(KEEP_DECODED).forEach(x => {
    if (x.i !== S.current){ x.e.decoded = null; x.e.log = null; } });
  byAge(e => e.raw && !e.file).slice(KEEP_RAW).forEach(x => {
    if (x.i !== S.current) x.e.raw = null; });
}

async function selectEntry(i, opt = {}){
  const e = S.entries[i];
  if (!e || S.busy) return;
  stop();
  S.current = i; S.busy = true; e.touched = performance.now();
  clearRegion();
  if (!e.local) history.replaceState(null, '', hashFor(e, i, false));
  UI.rows(); UI.transport(); UI.stamp(e);
  el.state.textContent = 'LOGGING';
  el.hint.textContent = 'Reading ' + e.title;

  try {
    if (!e.decoded){
      const {buf, size} = await bytesFor(e);
      const d = await decode(buf, e.title);
      e.size = size;
      e.badge = d.container + ' ' + d.encoding;
      e.decoded = d;
      e.log = logCore(d.chans, d.rate, p => { el.hint.textContent = 'Logging core ' + Math.round(p*100) + '%'; });
      e.dur = d.ab.duration;
      // recolour this core's place in the rack from its own mineral average
      let cs = 0, es = 0;
      for (let s = 0; s < SLICES; s++){ cs += e.log.cen[s]*e.log.rmsN[s]; es += e.log.rmsN[s]; }
      tintRack(i, mineral(es > 0 ? cs/es : 400, 0.55).clone());
    }
    const d = e.decoded;
    A.buffer = d.ab; A.offset = 0; A.peakHold = [0,0];
    ensureCtx(d.rate);
    setTrim(parseFloat(el.gain.value));
    buildCore(e.log);

    const tp = dB(e.log.truePeak);
    el.fmt.textContent = d.container + ' ' + d.encoding + ' / ' + d.ab.numberOfChannels + 'ch';
    el.rate.textContent = (d.rate/1000).toFixed(d.rate % 1000 ? 3 : 1) + ' kHz';
    el.ctx.textContent = A.native ? 'NATIVE' : (A.ctx.sampleRate/1000).toFixed(1) + ' kHz RESAMPLED';
    el.tp.textContent = (tp > 0 ? '+' : '') + tp.toFixed(1) + ' dBFS';
    el.tp.parentElement.classList.toggle('warn', tp > -0.1);
    el.hint.textContent = tp > 0
      ? 'Float headroom — pull trim to hear it clean'
      : 'Drag the core to seek';
    S.busy = false;
    if (opt.region) setRegion(opt.region[0], opt.region[1]);
    if (opt.seekTo) A.offset = clamp(opt.seekTo, 0, A.buffer.duration);
    UI.rows(); UI.ruler(); UI.transport(); UI.region();
    if (PHONE) setTab('read');
    if (opt.autoplay !== false) play();

    evict();
    const nx = neighbour(1);
    if (nx >= 0) setTimeout(() => prefetch(nx), 600);
  } catch (err){
    S.busy = false;
    e.failed = true;
    A.buffer = null;
    el.hint.textContent = 'Could not read this core';
    el.stMeta.innerHTML = `<span style="color:var(--alarm)">${String(err.message || err)}</span><br>
      <span style="color:var(--ash-lo)">Check the file path and that the host allows cross-origin reads.</span>`;
    UI.rows(); UI.transport();
  }
}
const step = d => { const n = neighbour(d); if (n >= 0) selectEntry(n); };

function setRegion(a, b){
  if (!A.buffer) return;
  const lo = clamp(Math.min(a,b), 0, A.buffer.duration), hi = clamp(Math.max(a,b), 0, A.buffer.duration);
  S.rgnA = lo; S.rgnB = hi;
  UI.region();
  if (A.src){ A.src.loopStart = lo; A.src.loopEnd = hi; }
}
function clearRegion(){
  S.rgnA = S.rgnB = null;
  UI.region();
  if (A.src){ A.src.loopStart = 0; A.src.loopEnd = 0; }
}

/* ─ shareable links: send someone straight to a sound, at a moment, in a
     marked region. Hash only, so Cloudflare needs no rewrite rule. ─ */
function hashFor(e, i, withTime){
  const p = new URLSearchParams();
  p.set('c', e.id || String(i));
  if (withTime){
    const t = position(); if (t > 0.5) p.set('t', t.toFixed(2));
    if (S.rgnA != null){ p.set('a', S.rgnA.toFixed(2)); p.set('b', S.rgnB.toFixed(2)); }
  }
  return '#' + p.toString();
}
async function copyLink(){
  const e = S.entries[S.current];
  if (!e) return;
  if (e.local){ el.hint.textContent = 'Local cores have no link — they never left this device'; return; }
  const url = location.origin + location.pathname + location.search + hashFor(e, S.current, true);
  try { await navigator.clipboard.writeText(url); el.hint.textContent = 'Link copied to this moment'; }
  catch(_){ el.hint.textContent = url; }
}
function applyHash(){
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const c = h.get('c');
  if (c === null) return false;
  let i = S.entries.findIndex(e => e.id === c);
  if (i < 0 && /^\d+$/.test(c)) i = +c;
  if (i < 0 || i >= S.entries.length) return false;
  const a = parseFloat(h.get('a')), b = parseFloat(h.get('b'));
  selectEntry(i, {
    autoplay: false,                       // arriving cold is not a user gesture
    seekTo: parseFloat(h.get('t')) || 0,
    region: (isFinite(a) && isFinite(b)) ? [a,b] : null
  });
  return true;
}
addEventListener('hashchange', () => {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const e = S.entries[S.current];
  if (!e || (h.get('c') !== (e.id || String(S.current)))) applyHash();
});

async function download(i){
  const e = S.entries[i];
  if (!e) return;
  const name = dlNameOf(e);
  const btn = el.rows.querySelector('[data-dl="' + i + '"]');
  if (btn){ btn.textContent = '·'; btn.disabled = true; }
  el.hint.textContent = 'Pulling ' + name;
  try {
    let blob;
    if (e.file) blob = e.file;
    else {
      const r = await fetch(srcOf(e), {mode:'cors'});
      if (!r.ok) throw new Error('HTTP ' + r.status);
      blob = await r.blob();
      if (!e.masterUrl) e.size = blob.size;
    }
    const a = document.createElement('a');
    const href = URL.createObjectURL(blob);
    a.href = href; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
    el.hint.textContent = 'Saved ' + name + '  ·  ' + bytes(blob.size);
  } catch (err){
    el.hint.textContent = 'Blocked — ' + (err.message || err);
  }
  UI.rows();
}

/* ═══ INPUT ══════════════════════════════════════════════════════════════ */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2(), pointer = new THREE.Vector2();
let dragging = false, hoverInst = -1, dragY = 0, dragT = 0;

function setNdc(ev){
  ndc.x = (ev.clientX / innerWidth) * 2 - 1;
  ndc.y = -(ev.clientY / innerHeight) * 2 + 1;
  pointer.set(ndc.x, ndc.y);
}
function seekFromRay(){
  if (!pickMesh || !A.buffer) return false;
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(pickMesh, false)[0];
  if (!hit) return false;
  const local = head.worldToLocal(hit.point.clone());
  seek(clamp((COL_H/2 - local.y) / COL_H, 0, 1) * A.buffer.duration);
  return true;
}

renderer.domElement.addEventListener('pointerdown', ev => {
  setNdc(ev);
  if (seekFromRay()){
    dragging = true; dragY = ev.clientY; dragT = position();
    renderer.domElement.setPointerCapture(ev.pointerId);
    return;
  }
  if (hoverInst >= 0) selectEntry(hoverInst);
});
renderer.domElement.addEventListener('pointermove', ev => {
  setNdc(ev);
  if (dragging){
    // ray first; if the finger has slid off the cylinder, fall back to the
    // vertical delta so the drag never dies halfway down the core
    if (!seekFromRay() && A.buffer){
      const perPx = A.buffer.duration / Math.max(120, innerHeight * 0.55);
      seek(dragT + (ev.clientY - dragY) * perPx);
    }
    return;
  }
  ray.setFromCamera(ndc, camera);
  const hit = rack.count ? ray.intersectObject(rack, false)[0] : null;
  const id = hit ? hit.instanceId : -1;
  if (id !== hoverInst){
    hoverInst = id;
    renderer.domElement.style.cursor = id >= 0 ? 'pointer' : 'default';
  }
  if (hoverInst >= 0 && S.entries[hoverInst]){
    el.label.textContent = pad(hoverInst+1,3) + ' · ' + S.entries[hoverInst].title;
    el.label.style.left = ev.clientX + 'px'; el.label.style.top = ev.clientY + 'px';
    el.label.classList.add('on');
  } else el.label.classList.remove('on');
});
addEventListener('pointerup', () => { dragging = false; });

addEventListener('touchmove', ev => {
  if (ev.touches && ev.touches.length > 1) return;   // leave pinch-zoom alone
  const t = ev.target;
  if (t instanceof Element && t.closest('#rows')) return;
  if (ev.cancelable) ev.preventDefault();
}, {passive:false});
renderer.domElement.addEventListener('pointerleave', () => el.label.classList.remove('on'));

/* ruler scrub */
const MARK_HOLD = 340;
let rulerDown = false, marking = false, markTimer = null, markAnchor = 0;

function tAt(ev){
  if (!A.buffer) return 0;
  const r = el.ruler.getBoundingClientRect();
  return clamp((ev.clientX - r.left) / r.width, 0, 1) * A.buffer.duration;
}
el.ruler.addEventListener('pointerdown', ev => {
  if (!A.buffer) return;
  el.ruler.setPointerCapture(ev.pointerId);
  rulerDown = true; marking = false; markAnchor = tAt(ev);
  clearTimeout(markTimer);
  markTimer = setTimeout(() => {
    marking = true;
    el.ruler.classList.add('marking');
    setRegion(markAnchor, markAnchor);
    el.hint.textContent = 'Drag to mark A/B';
    if (navigator.vibrate) navigator.vibrate(8);
  }, MARK_HOLD);
  seek(markAnchor);
});
el.ruler.addEventListener('pointermove', ev => {
  if (!rulerDown) return;
  if (marking) setRegion(markAnchor, tAt(ev));
  else { clearTimeout(markTimer); seek(tAt(ev)); }
});
function endRuler(){
  clearTimeout(markTimer);
  el.ruler.classList.remove('marking');
  if (marking){
    marking = false;
    if (S.rgnB - S.rgnA < 0.12){ clearRegion(); el.hint.textContent = 'A/B cleared'; }
    else { seek(S.rgnA); el.hint.textContent = 'A/B set — loop confines playback to it'; }
  }
  rulerDown = false;
}
el.ruler.addEventListener('pointerup', endRuler);
el.ruler.addEventListener('pointercancel', endRuler);
el.ruler.addEventListener('keydown', ev => {
  if (!A.buffer) return;
  const d = ev.key === 'ArrowLeft' ? -5 : ev.key === 'ArrowRight' ? 5 : 0;
  if (d){ ev.preventDefault(); seek(position() + d); }
});

/* deck */
$('#k-play').onclick = () => A.playing ? pause() : play();
$('#k-stop').onclick = () => stop();
$('#k-prev').onclick = () => step(-1);
$('#k-next').onclick = () => step(1);
const MODES = ['off','one','chain'];
$('#k-loop').onclick = () => {
  S.mode = MODES[(MODES.indexOf(S.mode) + 1) % MODES.length];
  UI.mode();
  el.hint.textContent = S.mode === 'off' ? 'Play once'
    : S.mode === 'one' ? 'Looping this core' : 'Chaining through the log';
};
el.link.onclick = copyLink;
$('#k-view').onclick = () => {
  S.view = S.view === 'read' ? 'rack' : 'read';
  wantPos.copy(VIEWS[S.view].p); wantAim.copy(VIEWS[S.view].a);
};
el.gain.addEventListener('input', () => {
  const v = parseFloat(el.gain.value);
  el.cgain.textContent = (v > 0 ? '+' : '') + v.toFixed(1);
  setTrim(v);
});
el.rows.addEventListener('click', ev => {
  const d = ev.target.closest('.dl');
  if (d){ ev.stopPropagation(); download(+d.dataset.dl); return; }
  const r = ev.target.closest('.row'); if (r && r.dataset.i) selectEntry(+r.dataset.i);
});
el.rows.addEventListener('keydown', ev => {
  const r = ev.target.closest('.row');
  if (r && r.dataset.i && (ev.key === 'Enter' || ev.key === ' ')){ ev.preventDefault(); selectEntry(+r.dataset.i); }
});
function setTab(t){
  document.body.dataset.tab = t;
  for (const b of el.tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === t));
}
el.tabs.addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (b) setTab(b.dataset.tab);
});
setTab('log');

el.search.addEventListener('input', () => { S.query = el.search.value.trim().toLowerCase(); UI.rows(); });
el.dl.onclick = () => { if (S.current >= 0) download(S.current); };
el.filter.addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  S.seam = b.dataset.seam; UI.filters(); UI.rows();
});

addEventListener('keydown', ev => {
  if (ev.target.matches('input,select,textarea')) return;
  switch (ev.key){
    case ' ': ev.preventDefault(); A.playing ? pause() : play(); break;
    case 'ArrowLeft':  if (A.buffer){ ev.preventDefault(); seek(position()-5); } break;
    case 'ArrowRight': if (A.buffer){ ev.preventDefault(); seek(position()+5); } break;
    case 'ArrowUp':    ev.preventDefault(); step(-1); break;
    case 'ArrowDown':  ev.preventDefault(); step(1); break;
    case 'l': case 'L': $('#k-loop').click(); break;
    case 'd': case 'D': if (S.current >= 0) download(S.current); break;
    case 'k': case 'K': copyLink(); break;
    case 'i': case 'I': if (A.buffer) setRegion(position(), S.rgnB != null ? S.rgnB : A.buffer.duration); break;
    case 'o': case 'O': if (A.buffer) setRegion(S.rgnA != null ? S.rgnA : 0, position()); break;
    case 'x': case 'X': clearRegion(); break;
    case '/': ev.preventDefault(); el.search.focus(); break;
    case 'Tab': if (!ev.shiftKey && ev.altKey){ ev.preventDefault(); $('#k-view').click(); } break;
  }
});

/* local files — logged, never uploaded */
const AUDIO_RE = /\.(wav|flac|aif|aiff|w64|rf64|mp3|ogg|opus|m4a)$/i;

/* a dropped folder arrives as entries, not files — walk it */
async function filesFromDrop(dt){
  const roots = dt.items ? [...dt.items].map(it => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean) : [];
  if (!roots.length) return [...dt.files];
  const out = [];
  async function walk(entry, path){
    if (entry.isFile){
      const f = await new Promise(res => entry.file(res, () => res(null)));
      if (f){ f._path = path; out.push(f); }
      return;
    }
    const rd = entry.createReader();
    for (;;){
      const batch = await new Promise(res => rd.readEntries(res, () => res([])));
      if (!batch.length) break;
      for (const c of batch) await walk(c, path + entry.name + '/');
    }
  }
  for (const r of roots) await walk(r, '');
  return out;
}

function addFiles(files){
  const added = [];
  const keep = [...files].filter(f => AUDIO_RE.test(f.name))
    .sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true}));
  for (const f of keep){
    S.entries.push({
      title: f.name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').toUpperCase(),
      file: f, size: f.size, local: true,
      tags: [(f._path || '').split('/').filter(Boolean).pop() || 'LOCAL'].map(t => t.toUpperCase().slice(0,12))
    });
    added.push(S.entries.length - 1);
  }
  if (!added.length){ el.hint.textContent = 'No audio in that drop'; return; }
  layoutRack(S.entries.length); UI.filters(); UI.rows();
  selectEntry(added[0]);
}
const dropEl = $('#drop');
let dragDepth = 0;
if (LOG_MODE){
  addEventListener('dragenter', e => { e.preventDefault(); if (++dragDepth === 1) dropEl.classList.add('on'); });
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('dragleave', e => { if (--dragDepth <= 0){ dragDepth = 0; dropEl.classList.remove('on'); } });
  addEventListener('drop', async e => {
    e.preventDefault(); dragDepth = 0; dropEl.classList.remove('on');
    if (!e.dataTransfer) return;
    el.hint.textContent = 'Reading drop…';
    addFiles(await filesFromDrop(e.dataTransfer));
  });
} else {
  // a visitor who drags a file onto a web page expects nothing to happen
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => e.preventDefault());
  $('#btn-local').style.display = 'none';
}
$('#btn-local').onclick = () => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.multiple = true;
  inp.accept = '.wav,.flac,.aif,.aiff,.w64,.mp3,.ogg,.opus,.m4a,audio/*';
  inp.onchange = () => addFiles(inp.files);
  inp.click();
};

/* ═══ MANIFEST ═══════════════════════════════════════════════════════════ */
async function loadManifest(){
  try {
    const r = await fetch('archive.json', {cache:'no-cache'});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const m = await r.json();
    const base = m.base || '';
    S.collection = m.collection || 'CACHE ARCHIVE';
    S.entries = (m.entries || []).map(e => ({
      title: (e.title || e.file || 'UNTITLED').toUpperCase(),
      url: /^https?:/i.test(e.file) ? e.file : base + e.file,
      masterUrl: e.master ? (/^https?:/i.test(e.master) ? e.master : base + e.master) : null,
      tags: (e.tags || []).map(t => t.toUpperCase()),
      loc: e.loc, date: e.date, notes: e.notes, license: e.license, id: e.id
    }));
    el.coll.textContent = S.collection;
  } catch (err){
    el.coll.textContent = 'NO MANIFEST';
    el.hint.textContent = 'archive.json not found';
  }
  layoutRack(S.entries.length);
  UI.filters(); UI.rows(); UI.stamp(null);
  el.hint.textContent = S.entries.length
    ? S.entries.length + ' cores · ' + (LOG_MODE ? 'drop to log more' : 'listen, then take what you need')
    : (LOG_MODE ? 'Drop audio to log' : 'Archive unavailable');
}

/* ═══ LOOP ═══════════════════════════════════════════════════════════════ */
let last = performance.now(), spin = 0, frameFaults = 0, running = true;
function frame(now){
  if (running) requestAnimationFrame(frame);
  try { tick(now); frameFaults = 0; }
  catch (err){
    if (++frameFaults >= 3){
      running = false;
      $('#boot').classList.remove('done');
      $('#boot-msg').textContent = 'render loop halted after 3 consecutive faults';
      $('#boot-err').textContent += (err && (err.stack || err.message) || err) + '\n';
    }
  }
}
function tick(now){
  const dt = Math.min(0.05, (now - last)/1000); last = now;

  const f = UI.frame();

  // camera: eased, with a hand's-width of pointer parallax
  const k = REDUCED ? 1 : 1 - Math.pow(0.0015, dt);
  camPos.lerp(wantPos, k); camAim.lerp(wantAim, k);
  camera.position.copy(camPos).add(new THREE.Vector3(pointer.x*0.30*PARALLAX, pointer.y*0.20*PARALLAX, 0));
  camera.lookAt(camAim);

  // the core turns slowly, and holds still while you are reading a depth
  if (!dragging && !REDUCED) spin += dt * 0.085;
  head.rotation.y = spin;

  if (A.playing && A.src && !A.src.loop && S.rgnB != null && position() >= S.rgnB - 0.004) endOfCore();

  const cur = S.entries[S.current];
  if (A.buffer && coreLines && cur && cur.log){
    scan.position.y = COL_H/2 - f*COL_H;
    const sl = Math.min(SLICES-1, Math.floor(f*SLICES)), row = sl*NB;
    const bands = cur.log.bands, lp = liveGeo.attributes.position;
    for (let b = 0; b < NB; b++){
      const t = b/NB*TAU, r = R0 + RM*bands[row+b] + 0.012;
      lp.array[b*3] = Math.cos(t)*r; lp.array[b*3+1] = 0; lp.array[b*3+2] = Math.sin(t)*r;
    }
    lp.needsUpdate = true;
    const lvl = cur.log.rmsN[sl];
    toolRing.material.opacity = 0.45 + lvl*0.55;
    liveTrace.material.opacity = 0.55 + lvl*0.45;
  }

  // dust: rises through the lamp cone, wraps at the top
  const dp = dustGeo.attributes.position;
  for (let i = 0; i < DUST; i++){
    let y = dp.array[i*3+1] + dt * (0.02 + dseed[i]*0.05);
    if (y > 3.9) y = -3.9;
    dp.array[i*3+1] = y;
    dp.array[i*3] += Math.sin(now*0.0002 + dseed[i]*9) * dt * 0.006;
  }
  dp.needsUpdate = true;

  postMat.uniforms.uT.value = now * 0.001;
  if (POST){
    try {
      renderer.setRenderTarget(rtScene);
      renderer.render(scene, camera);
      pass(brightMat, rtBright);
      blurMat.uniforms.tD.value = rtBright.texture;
      blurMat.uniforms.uDir.value.set(1/rtBright.width, 0);   pass(blurMat, rtBlurA);
      blurMat.uniforms.tD.value = rtBlurA.texture;
      blurMat.uniforms.uDir.value.set(0, 1/rtBright.height);  pass(blurMat, rtBlurB);
      pass(postMat, null);
    } catch (err){
      POST = false; renderer.setRenderTarget(null);
      el.hint.textContent = 'Post pass off — ' + (err.message || 'unsupported');
    }
  } else renderer.render(scene, camera);
}

/* ═══ BOOT ═══════════════════════════════════════════════════════════════ */
(async function start(){
  boot('lattice');
  UI.scale(); resize();
  boot('manifest');
  await loadManifest();
  UI.mode(); UI.region(); UI.transport();
  if (applyHash()) boot('link');
  requestAnimationFrame(frame);
  requestAnimationFrame(() => { resize(); camPos.copy(wantPos); camAim.copy(wantAim); });
  window.__adit.ready = true;
  boot('ready');
  setTimeout(() => $('#boot').classList.add('done'), 900);
})();
