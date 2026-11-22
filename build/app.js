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
  /* Four channels might be first-order ambisonics. Per slice and per band (low < 300 Hz, mid, high
     > 3 kHz) keep Re(W·conj(C)) for the three other channels and |W|²: the active intensity vector,
     which points at where that band's energy came from (Pulkki's DirAC). Which channel is X depends on
     the format, AmbiX or FuMa, so that is resolved when it is drawn, not here. */
  const ivb = nch === 4 ? new Float32Array(SLICES*12) : null;
  const fr = ivb ? [0,1,2,3].map(() => new Float32Array(WIN)) : null;
  const fi = ivb ? [0,1,2,3].map(() => new Float32Array(WIN)) : null;
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
    if (ivb){
      for (let c = 0; c < 4; c++){
        const R = fr[c], I = fi[c], ch = chans[c]; I.fill(0);
        for (let i = 0; i < WIN; i++) R[i] = (wStart + i < n ? ch[wStart+i] : 0) * win[i];
        fft(R, I);
      }
      const o = s*12;
      for (let k = 1; k < WIN/2; k++){
        const fq = k*rate/WIN, j = o + (fq < 300 ? 0 : fq < 3000 ? 4 : 8);
        const wr = fr[0][k], wi = fi[0][k];
        ivb[j]   += wr*fr[1][k] + wi*fi[1][k];
        ivb[j+1] += wr*fr[2][k] + wi*fi[2][k];
        ivb[j+2] += wr*fr[3][k] + wi*fi[3][k];
        ivb[j+3] += wr*wr + wi*wi;
      }
    }
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

  return {rms, rmsN, cen, pk, bed, bands, bandHz, eMin, eMax, truePeak, ivb, dur: n/rate};
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
  if (MON.ctx !== A.ctx) buildMonitor(A.buffer.numberOfChannels);   // the context was replaced under us
  s.buffer = A.buffer; s.connect(A.monIn || A.gain);
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

/* ─ MONITOR ──────────────────────────────────────────────────────────────────
   Web Audio down-mixes anything past stereo by speaker rules: four channels
   are taken as quad, six as 5.1, and the rest past two are simply dropped. A
   field recorder's poly WAV is none of those, and an ambisonic B-format file
   played as quad is nonsense. So the monitor splits the channels itself:

   MIX    every channel you leave on, summed to both ears at 1/√n.
   AMBIX  first-order B-format, ACN order (W Y Z X), SN3D.
   FUMA   first-order B-format, FuMa order (W X Y Z), W 3 dB down.

   B-format is decoded to eight virtual speakers on a cube, max-rE weighted,
   each through the browser's own HRTF panner, so on headphones a sound keeps
   its place as you turn. Turning rotates the decode, not the file.

   The RECEIVER is where you stand in the field. Moving it off centre applies
   Gerzon's dominance (a Lorentz-style boost of W against the velocity
   components, Gerzon & Barton 1992): sounds the way you moved come up to
   +12 dB and those behind drop as far, which is what first order can honestly
   say about walking toward something. You also turn to face where you moved.
   Live listening and the rendered WAV use the same matrix, so what you send
   on is what you heard. Download and the core itself stay the recorded
   channels.                                                                 */
const MON = {ctx:null, n:0, mode:'mix', on:[], yaw:0, pitch:0, pos:[0,0,0], mix:[], dec:[], nodes:[]};
const DOM_DB = 12, POS_MAX = 0.85;
const ambiOn = () => MON.n === 4 && MON.mode !== 'mix' && MON.dec.length > 0;

/* 8 × 4 decode gains in the file's own channel order: dominance toward the receiver, then max-rE
   sampling of the field in the direction each speaker faces once the head has turned. */
function ambiRows(mode, pos, yaw, pitch){
  const fuma = mode === 'fuma';
  const r = Math.hypot(pos[0], pos[1], pos[2]);
  const lam = Math.pow(10, clamp(r / POS_MAX, 0, 1) * DOM_DB / 20);
  const a = (lam + 1/lam)/2, b = (lam - 1/lam)/2;
  const v = r > 1e-6 ? [pos[0]/r, pos[1]/r, pos[2]/r] : [1, 0, 0];
  const T = [[a, b*v[0], b*v[1], b*v[2]]];                       // canonical W X Y Z, SN3D
  for (let i = 0; i < 3; i++){ const row = [b*v[i]]; for (let j = 0; j < 3; j++) row.push((i === j ? 1 : 0) + (a - 1)*v[i]*v[j]); T.push(row); }
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), spp = Math.sin(pitch);
  const K = Math.sqrt(8)/8, G1 = 3 * 0.577;                     // 1/N basic decode, energy make-up, max-rE
  return SPK.map(([x, y, z]) => {
    const x1 = x*cp - z*spp, z1 = x*spp + z*cp;                  // the speaker in front of your face samples
    const w = [x1*cy - y*sy, x1*sy + y*cy, z1];                  // where you are looking: pitch, then yaw
    const q = [K, K*G1*w[0], K*G1*w[1], K*G1*w[2]];
    const rc = [0,1,2,3].map(j => q[0]*T[0][j] + q[1]*T[1][j] + q[2]*T[2][j] + q[3]*T[3][j]);
    return fuma ? [rc[0]*Math.SQRT2, rc[1], rc[2], rc[3]]     // W X Y Z, W 3 dB down
                : [rc[0], rc[2], rc[3], rc[1]];                // W Y Z X
  });
}
/* one virtual speaker: a sum node into an HRTF panner placed on the cube */
function speaker(ctx, u, out){
  const sum = ctx.createGain(), pn = ctx.createPanner();
  pn.panningModel = 'HRTF'; pn.distanceModel = 'linear'; pn.rolloffFactor = 0;
  // ambisonic axes are X front, Y left, Z up; Web Audio's listener faces −Z with +X to the right
  const px = -u[1], py = u[2], pz = -u[0];
  if (pn.positionX){ pn.positionX.value = px; pn.positionY.value = py; pn.positionZ.value = pz; }
  else pn.setPosition(px, py, pz);
  sum.connect(pn); pn.connect(out);
  return [sum, pn];
}
const AMBI_RE = /ambix|ambisonic|\bfoa\b|b-?format|h3-?vr|nt-?sf1/i;
const SPK = [];
for (const x of [1,-1]) for (const y of [1,-1]) for (const z of [1,-1]) SPK.push([x/Math.sqrt(3), y/Math.sqrt(3), z/Math.sqrt(3)]);

function buildMonitor(n){
  for (const x of MON.nodes){ try { x.disconnect(); } catch(_){} }
  MON.nodes = []; MON.mix = []; MON.dec = []; MON.ctx = A.ctx; MON.n = n;
  if (n <= 2 || !A.ctx){ A.monIn = A.gain; return; }
  const ctx = A.ctx, sp = ctx.createChannelSplitter(n), mg = ctx.createChannelMerger(2);
  MON.nodes.push(sp, mg);
  for (let c = 0; c < n; c++){
    const g = ctx.createGain(); g.gain.value = 0;
    sp.connect(g, c); g.connect(mg, 0, 0); g.connect(mg, 0, 1);
    MON.mix.push(g); MON.nodes.push(g);
  }
  mg.connect(A.gain);
  if (n === 4 && ctx.createPanner){
    for (const u of SPK){
      const [sum, pn] = speaker(ctx, u, A.gain);
      const row = [];
      for (let c = 0; c < 4; c++){ const g = ctx.createGain(); g.gain.value = 0; sp.connect(g, c); g.connect(sum); row.push(g); MON.nodes.push(g); }
      MON.dec.push(row); MON.nodes.push(sum, pn);
    }
  }
  A.monIn = sp;
  setMonitor();
}

function setMonitor(){
  if (MON.n <= 2 || !MON.ctx) return;
  const t = MON.ctx.currentTime, amb = MON.n === 4 && MON.mode !== 'mix' && MON.dec.length;
  const lit = MON.on.filter(Boolean).length || 1;
  MON.mix.forEach((g, c) => g.gain.setTargetAtTime(!amb && MON.on[c] ? 1/Math.sqrt(lit) : 0, t, 0.015));
  if (!MON.dec.length) return;
  const rows = ambiRows(MON.mode, MON.pos, MON.yaw, MON.pitch);
  MON.dec.forEach((row, s) => row.forEach((g, c) => g.gain.setTargetAtTime(amb ? rows[s][c] : 0, t, 0.02)));
}

/* What you hear at the receiver, as a stereo float render. Same matrix as the live monitor. Offline in
   20 s pieces, each warmed with the samples before it so the HRTF filters carry over, which keeps a
   long four-channel take from needing two more copies of itself in memory at once. */
async function renderHeard(e, region){
  const d = e.decoded;
  if (!d || d.chans.length !== 4) throw new Error('not a four-channel core');
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) throw new Error('this browser cannot render offline');
  const rate = d.rate, n = d.chans[0].length;
  const a0 = region ? Math.max(0, Math.floor(region[0]*rate)) : 0;
  const a1 = region ? Math.min(n, Math.ceil(region[1]*rate)) : n;
  const len = a1 - a0;
  if (len <= 0) throw new Error('nothing to render');
  const rows = ambiRows(MON.mode, MON.pos, MON.yaw, MON.pitch);
  const L = new Float32Array(len), R = new Float32Array(len), CH = rate*20;
  for (let at = 0; at < len; at += CH){
    const pre = Math.min(4096, a0 + at), m = Math.min(CH, len - at) + pre, from = a0 + at - pre;
    const oc = new OAC(2, m, rate);
    const buf = oc.createBuffer(4, m, rate);
    for (let c = 0; c < 4; c++) buf.getChannelData(c).set(d.chans[c].subarray(from, from + m));
    const src = oc.createBufferSource(); src.buffer = buf;
    const sp = oc.createChannelSplitter(4); src.connect(sp);
    rows.forEach((row, k) => {
      const [sum] = speaker(oc, SPK[k], oc.destination);
      row.forEach((g, c) => { const gn = oc.createGain(); gn.gain.value = g; sp.connect(gn, c); gn.connect(sum); });
    });
    src.start();
    const out = await oc.startRendering();
    L.set(out.getChannelData(0).subarray(pre), at); R.set(out.getChannelData(1).subarray(pre), at);
    el.hint.textContent = 'Rendering what you hear · ' + Math.round(Math.min(1, (at + CH)/len)*100) + '%';
  }
  return {chans: [L, R], rate};
}
/* where the receiver is, in words */
function heardLabel(){
  const r = Math.hypot(...MON.pos) / POS_MAX;
  if (r < 0.08) return 'at the centre';
  const deg = Math.round(Math.abs(MON.yaw) * 180/Math.PI), el_ = Math.round(MON.pitch * 180/Math.PI);
  const dir = deg < 3 ? 'ahead' : deg > 177 ? 'behind' : deg + '° ' + (MON.yaw > 0 ? 'left' : 'right');
  return dir + (Math.abs(el_) >= 8 ? ', ' + Math.abs(el_) + '° ' + (el_ > 0 ? 'up' : 'down') : '') + ' · +' + (r*DOM_DB).toFixed(1) + ' dB';
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
   for whoever maintains it, so it lives behind ?log and is invisible otherwise.
   Inside Public Workbench (window.__workbench, set by Workbench's corner-mark script) ADIT is the
   library instead: it reads what the other tools have kept on this device, keeps files you open, and
   hands a sound on to another tool. The archive is still there, as one shelf among the others. */
const LIB = !!(window.__workbench);
const LOG_MODE = new URLSearchParams(location.search).has('log') || LIB;

const nameFrom = (u, fallback) => {
  try { return decodeURIComponent(new URL(u, location.href).pathname.split('/').pop()) || fallback; }
  catch(_){ return String(fallback).replace(/[^\w.-]+/g,'_'); }
};
const nameOf   = e => e.file ? e.file.name : e.dlName ? e.dlName : nameFrom(e.url, e.title);
/* FLAC streams because it is half the weight; the download is the float master
   when there is one, since FLAC is integer-only and cannot carry the headroom. */
const srcOf    = e => e.masterUrl || e.url;
const dlNameOf = e => e.file ? e.file.name : e.dlName ? e.dlName : nameFrom(srcOf(e), e.title);
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
  rack: {p:new THREE.Vector3(0.2,0.4,1.0),   a:new THREE.Vector3(0.2,-3.0,-6.8)},
  dive: {p:new THREE.Vector3(), a:new THREE.Vector3()}      // follows the read head every frame
};
const VIEW_ORDER = ['read', 'dive', 'rack'];

const TOUCH = matchMedia('(pointer:coarse)').matches;
const PHONE = matchMedia('(max-width:1000px)').matches;   // the tabbed layout, phones and tablets
const PARALLAX = TOUCH ? 0 : 1;      // no cursor to follow, so no drift
if (PHONE){ camera.fov = 42; camera.updateProjectionMatrix(); }
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

/* ─ rack: the rest of the log, stood on end in the dark ──────────────────────
   They were solid slabs once, lying mid-air behind the specimen; bloomed, they
   read as dashes struck through it. Now each is drawn the way the specimen
   is, in hairlines: end caps, a few strata rings, four ribs. They stand on the
   datum, parallel to the specimen so nothing crosses it, and the one on the
   head takes its mineral colour. The instanced cylinders are only there to be
   tapped.                                                                   */
const RK_COLS = PHONE ? 3 : 6;          // a phone sees three across; the rest recede behind
const RACK_MAX = 256, RK_SEG = 12, RK_RINGS = 6, RK_RIBS = 4, RK_R = 0.11, RK_H = 1.1;
const RK_V = (RK_RINGS*RK_SEG + RK_RIBS) * 2;
const rackGeo = new THREE.CylinderGeometry(0.24, 0.24, RK_H + 0.1, 8, 1);
rackGeo.translate(0, RK_H/2, 0);
const rack = new THREE.InstancedMesh(rackGeo, new THREE.MeshBasicMaterial({visible:false}), RACK_MAX);
rack.count = 0;
const rackGrp = new THREE.Group(); rackGrp.add(rack); scene.add(rackGrp);
let rackLines = null;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1,1,1);
const rackHome = [];

function hash1(n){ const s = Math.sin(n)*43758.5453; return s - Math.floor(s); }

function layoutRack(n){
  rack.count = Math.min(n, RACK_MAX);
  rackHome.length = 0;
  const COLS = RK_COLS;
  const pos = new Float32Array(rack.count*RK_V*3), col = new Float32Array(rack.count*RK_V*3);
  let v = 0;
  const put = (x, y, z, c) => { pos[v*3] = x; pos[v*3+1] = y; pos[v*3+2] = z; col[v*3] = c.r; col[v*3+1] = c.g; col[v*3+2] = c.b; v++; };
  for (let i = 0; i < rack.count; i++){
    const c = i % COLS, r = Math.floor(i / COLS);
    const p = new THREE.Vector3(c*1.15 + (r % 2)*0.57 + hash1(i)*0.06, 0, -r*0.95 + hash1(i*3)*0.06);
    rackHome.push(p);
    _m.compose(p, _q.identity(), _s);
    rack.setMatrixAt(i, _m);
    const tint = new THREE.Color(0x4a3424).lerp(new THREE.Color(0x8a5a34), hash1(i*11)*0.6);
    for (let j = 0; j < RK_RINGS; j++){
      const y = j/(RK_RINGS-1)*RK_H, end = j === 0 || j === RK_RINGS-1;
      const rr = end ? RK_R : RK_R*(0.8 + hash1(i*13 + j)*0.45);    // strata: no two cores alike
      for (let k = 0; k < RK_SEG; k++){
        const a0 = k/RK_SEG*TAU, a1 = (k+1)/RK_SEG*TAU;
        put(p.x+Math.cos(a0)*rr, p.y+y, p.z+Math.sin(a0)*rr, tint);
        put(p.x+Math.cos(a1)*rr, p.y+y, p.z+Math.sin(a1)*rr, tint);
      }
    }
    for (let k = 0; k < RK_RIBS; k++){
      const a = k/RK_RIBS*TAU + 0.4;
      put(p.x+Math.cos(a)*RK_R, p.y, p.z+Math.sin(a)*RK_R, tint);
      put(p.x+Math.cos(a)*RK_R, p.y+RK_H, p.z+Math.sin(a)*RK_R, tint);
    }
  }
  rack.instanceMatrix.needsUpdate = true;
  if (rackLines){ rackGrp.remove(rackLines); rackLines.geometry.dispose(); rackLines = null; }
  if (rack.count){
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    rackLines = new THREE.LineSegments(g, trace({vertexColors:true, opacity:0.9}));
    rackGrp.add(rackLines);
  }
}
function tintRack(i, col){
  if (!rackLines || i < 0 || i >= rack.count) return;
  const ca = rackLines.geometry.attributes.color;
  for (let k = i*RK_V; k < (i+1)*RK_V; k++) ca.setXYZ(k, col.r, col.g, col.b);
  ca.needsUpdate = true;
}

/* ─ SPACE: the ambisonic field as a ball you stand in ─────────────────────────
   Hairline parallels and meridians; the recording's front is the amber tick on
   the equator. Every slice puts three points on it (low in rust nearest you,
   mid in amber, high in bone outermost) where that band's energy came from;
   diffuse energy sits further in, because it came from all round you. The
   whole take is a faint constellation; the moment under the read head flares
   and trails a comet of the last few seconds. The teal glyph is you: drag it
   and the field leans toward where you went.                               */
const RB = 2.3;
const ball = new THREE.Group(); ball.position.x = COL_X; ball.visible = false; scene.add(ball);
const A2T = (x, y, z, o) => o.set(-y, z, -x);                  // ambisonic X front, Y left, Z up → scene
const T2A = v => [-v.z, -v.x, v.y];
{
  const v = [], ring = (el, segs) => {
    for (let i = 0; i < segs; i++){
      const a0 = i/segs*TAU, a1 = (i+1)/segs*TAU, ce = Math.cos(el)*RB, y = Math.sin(el)*RB;
      v.push(Math.cos(a0)*ce, y, Math.sin(a0)*ce, Math.cos(a1)*ce, y, Math.sin(a1)*ce);
    }
  };
  for (const deg of [-60, -30, 30, 60]) ring(deg*Math.PI/180, 72);
  for (let m = 0; m < 12; m++){
    const az = m/12*TAU;
    for (let i = 0; i < 36; i++){
      const e0 = -Math.PI/2 + i/36*Math.PI, e1 = -Math.PI/2 + (i+1)/36*Math.PI;
      v.push(Math.cos(az)*Math.cos(e0)*RB, Math.sin(e0)*RB, Math.sin(az)*Math.cos(e0)*RB,
             Math.cos(az)*Math.cos(e1)*RB, Math.sin(e1)*RB, Math.sin(az)*Math.cos(e1)*RB);
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  ball.add(new THREE.LineSegments(g, trace({color:0xCFC8BC, opacity:0.075})));
  const eq = new THREE.Line(ringGeo(RB, 144), trace({color:0xCFC8BC, opacity:0.24})); ball.add(eq);
  // the recording's front: a short amber tick on the equator, pointing in
  const f = new THREE.Vector3(); A2T(1, 0, 0, f);
  const fg = new THREE.BufferGeometry().setFromPoints([f.clone().multiplyScalar(1.10), f.clone().multiplyScalar(0.94)]);
  ball.add(new THREE.Line(fg, trace({color:0xE7B24C, opacity:0.95, fog:false})));
}
/* a soft round mote: points are square in WebGL unless they are given a shape */
const MOTE = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.28, 'rgba(255,255,255,.75)');
  r.addColorStop(0.6, 'rgba(255,255,255,.18)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
let fieldPts = null, fieldE = null, fieldF = null;
const BAND_COL = [P_RUST, P_AMBER, P_BONE];
function buildField(log, mode){
  if (fieldPts){ ball.remove(fieldPts); fieldPts.geometry.dispose(); fieldPts = null; }
  if (!log || !log.ivb) return;
  const fuma = mode === 'fuma', N = SLICES*3, iv = log.ivb;
  const pos = new Float32Array(N*3), col = new Float32Array(N*3);
  fieldE = new Float32Array(N); fieldF = new Float32Array(N);
  const emax = [1e-12, 1e-12, 1e-12];
  for (let s2 = 0; s2 < SLICES; s2++) for (let b = 0; b < 3; b++) emax[b] = Math.max(emax[b], iv[s2*12 + b*4 + 3]);
  const p = new THREE.Vector3();
  for (let s2 = 0; s2 < SLICES; s2++) for (let b = 0; b < 3; b++){
    const o = s2*12 + b*4, E = iv[o+3], k = s2*3 + b;
    const X = fuma ? iv[o] : iv[o+2], Y = fuma ? iv[o+1] : iv[o], Z = fuma ? iv[o+2] : iv[o+1];
    const m = Math.hypot(X, Y, Z);
    const focus = E > 0 ? clamp(m / E * (fuma ? Math.SQRT1_2 : 1), 0, 1) : 0;
    fieldE[k] = Math.sqrt(E / emax[b]); fieldF[k] = focus;
    const r = RB * (0.80 + 0.09*b) * (0.62 + 0.38*focus);
    if (m > 0) A2T(X/m*r, Y/m*r, Z/m*r, p); else p.set(0, 0, 0);
    pos[k*3] = p.x; pos[k*3+1] = p.y; pos[k*3+2] = p.z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  fieldPts = new THREE.Points(g, new THREE.PointsMaterial({size:0.11, map:MOTE, vertexColors:true, transparent:true,
    blending:THREE.AdditiveBlending, depthWrite:false, sizeAttenuation:true, fog:false}));
  ball.add(fieldPts);
}
// the moment under the read head: three flares, and a ray from each to you
const nowGeo = new THREE.BufferGeometry();
nowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
nowGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9), 3));
const nowPts = new THREE.Points(nowGeo, new THREE.PointsMaterial({size:0.42, map:MOTE, vertexColors:true, transparent:true,
  blending:THREE.AdditiveBlending, depthWrite:false, sizeAttenuation:true, fog:false}));
const rayGeo = new THREE.BufferGeometry();
rayGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
rayGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(18), 3));
const rays = new THREE.LineSegments(rayGeo, trace({vertexColors:true, opacity:1, fog:false}));
ball.add(nowPts, rays);
// you: a ring, a nose, a point. The pick sphere is generous so a thumb finds it.
const rcv = new THREE.Group();
rcv.add(new THREE.Line(ringGeo(0.16, 48), trace({color:0x9FF0D6, opacity:0.95, fog:false})));
const noseGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -0.5)]);
const nose = new THREE.Line(noseGeo, trace({color:0x9FF0D6, opacity:0.95, fog:false}));
rcv.add(nose);
const rcvDot = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]),
  new THREE.PointsMaterial({color:0x9FF0D6, size:0.3, map:MOTE, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, fog:false}));
rcv.add(rcvDot);
const rcvPick = new THREE.Mesh(new THREE.SphereGeometry(TOUCH ? 0.55 : 0.38, 12, 8), new THREE.MeshBasicMaterial({visible:false}));
rcv.add(rcvPick);
ball.add(rcv);
const ORB = {az: 0.55, el: 0.32};
const _p = new THREE.Vector3(), _q2 = new THREE.Vector3();
function updateField(f, dur){
  A2T(MON.pos[0]*RB, MON.pos[1]*RB, MON.pos[2]*RB, rcv.position);
  // nose: the way you face
  const cp = Math.cos(MON.pitch);
  A2T(Math.cos(MON.yaw)*cp, Math.sin(MON.yaw)*cp, Math.sin(MON.pitch), _p);
  noseGeo.attributes.position.setXYZ(1, _p.x*0.5, _p.y*0.5, _p.z*0.5); noseGeo.attributes.position.needsUpdate = true;
  if (!fieldPts) return;
  const col = fieldPts.geometry.attributes.color, pos = fieldPts.geometry.attributes.position;
  const sl = f * SLICES, per = (dur || 1) / SLICES, TRAIL = 3.5;
  for (let s2 = 0; s2 < SLICES; s2++){
    const age = (sl - s2) * per;
    const flare = age >= 0 && age < TRAIL ? Math.pow(1 - age/TRAIL, 2) : 0;
    for (let b = 0; b < 3; b++){
      const k = s2*3 + b, e = fieldE[k], fo = fieldF[k], c = BAND_COL[b];
      const v = (0.045 + 0.16*e*fo) + flare*(0.35 + 1.4*e)*(0.35 + 0.65*fo);
      col.setXYZ(k, c.r*v, c.g*v, c.b*v);
    }
  }
  col.needsUpdate = true;
  const s0 = Math.min(SLICES-1, Math.max(0, Math.floor(sl)));
  const np = nowGeo.attributes.position, nc = nowGeo.attributes.color, rp = rayGeo.attributes.position, rc = rayGeo.attributes.color;
  for (let b = 0; b < 3; b++){
    const k = s0*3 + b, e = fieldE[k], fo = fieldF[k], c = BAND_COL[b];
    _p.fromBufferAttribute(pos, k);
    np.setXYZ(b, _p.x, _p.y, _p.z);
    const v = A.playing || A.offset > 0 ? (0.25 + 1.3*e) * (0.4 + 0.6*fo) : 0;
    nc.setXYZ(b, c.r*v, c.g*v, c.b*v);
    rp.setXYZ(b*2, rcv.position.x, rcv.position.y, rcv.position.z); rp.setXYZ(b*2+1, _p.x, _p.y, _p.z);
    const w = v * 0.45;
    rc.setXYZ(b*2, 0.62*w, 0.94*w, 0.84*w); rc.setXYZ(b*2+1, c.r*w, c.g*w, c.b*w);
  }
  np.needsUpdate = nc.needsUpdate = rp.needsUpdate = rc.needsUpdate = true;
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

/* The stage: what the strip, the deck and (on a wide screen) the log and the meters leave free. */
let STAGE = {l:0, r:1, t:0, b:1};
function stageRect(){
  const W = Math.max(1, innerWidth), H = Math.max(1, innerHeight);
  const shown = n => { if (!n || getComputedStyle(n).display === 'none') return null;
    const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; };
  let t = 0, b = H, l = 0, r = W, x;
  if ((x = shown($('#tabs')))) t = x.bottom; else if ((x = shown($('#strip')))) t = x.bottom;
  if ((x = shown($('#deck')))) b = x.top;
  if (!PHONE){
    if ((x = shown($('#index')))) l = x.right;
    if ((x = shown($('#meter')))) r = x.left;
  }
  t += 14; b -= 14; l += 14; r -= 14;
  if (b - t < 90){ t = 0; b = H; }                  // degenerate window: take the lot
  if (r - l < 120){ l = 0; r = W; }
  return STAGE = {l, r, t, b};
}
/* Camera position and aim that put `centre` in the middle of the stage, seen from `dir` at `d`. */
function aimFor(centre, dir, d, outPos, outAim){
  const W = Math.max(1, innerWidth), H = Math.max(1, innerHeight), st = STAGE;
  const Vh = 2 * d * Math.tan(camera.fov * Math.PI / 360), Vw = Vh * (W / H);
  const fwd = dir.clone().negate(), right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
  const up2 = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const ox = ((st.l + st.r)/2 - W/2) / W * Vw, oy = ((st.t + st.b)/2 - H/2) / H * Vh;
  outAim.copy(centre).addScaledVector(right, -ox).addScaledVector(up2, oy);
  outPos.copy(outAim).addScaledVector(dir, d);
}
/* The title stands beside the specimen when there is room, else it shrinks to the stage's corner. */
function placeStamp(coreHalfPx){
  const st = el.stamp.style;
  if (PHONE){                                       // one column: over the specimen, so just the name
    st.left = st.top = st.maxWidth = st.transform = '';
    if (S.current >= 0) el.stamp.dataset.fit = 'tight'; else delete el.stamp.dataset.fit;
    return;
  }
  const S_ = STAGE, cx = (S_.l + S_.r)/2, gap = cx - coreHalfPx - S_.l;
  if (gap >= 230 && (S.view === 'read' || S.current < 0)){
    st.left = (S_.l + 18) + 'px'; st.top = ((S_.t + S_.b)/2) + 'px'; st.transform = 'translateY(-50%)';
    st.maxWidth = Math.min(420, gap - 48) + 'px'; delete el.stamp.dataset.fit;
  } else {
    st.left = (S_.l + 10) + 'px'; st.top = (S_.t + 4) + 'px'; st.transform = 'none';
    st.maxWidth = Math.min(420, S_.r - S_.l - 20) + 'px'; el.stamp.dataset.fit = 'tight';
  }
}

function frameRead(){
  const H = Math.max(1, innerHeight), W = Math.max(1, innerWidth);
  const st = stageRect();
  const band = clamp((st.b - st.t) / H, 0.15, 1);   // share of viewport we own
  const d = PHONE ? 8.4 : 7.4;
  const tanH = Math.tan(camera.fov * Math.PI / 360);
  const Vh = 2 * d * tanH;

  // fill the stage's height, unless the stage is narrower than the specimen would then be wide
  const kW = ((st.r - st.l) / W) * Vh * (W / H) / 2.6;
  const k = clamp(Math.min((band * Vh) / CORE_SPAN, kW), 0.2, 1.3);
  head.scale.setScalar(k);
  dustGrp.scale.setScalar(k);
  gridMesh.position.y = -(COL_H/2 + 0.55) * k;
  const floor = gridMesh.position.y;
  rackGrp.position.set(-3.0, floor, -6.4);
  /* stand back far enough to take in a whole row of the tray, a little above it. On a desktop the
     log panel covers the left of the window, so aim at the middle of what is left, not of the window. */
  const rx = -3.0 + ((RK_COLS - 1)*1.15 + 0.57)/2 + (PHONE ? 0 : -0.8);
  VIEWS.rack.a.set(rx, floor + 0.45, -7.4);
  VIEWS.rack.p.set(rx, floor + (PHONE ? 3.4 : 3.2), -6.4 + (PHONE ? 9.0 : 9.6));
  if (S.view === 'rack'){ wantPos.copy(VIEWS.rack.p); wantAim.copy(VIEWS.rack.a); }

  aimFor(new THREE.Vector3(COL_X, 0, 0), READ_DIR, d, VIEWS.read.p, VIEWS.read.a);
  if (S.view === 'read'){ wantPos.copy(VIEWS.read.p); wantAim.copy(VIEWS.read.a); }
  placeStamp((R0 + RM + 0.5) * k / (Vh * W / H) * W);
}
/* SPACE: orbit the ball at a distance that makes it fill most of the stage's shorter side */
function frameSpace(){
  const H = Math.max(1, innerHeight), st = STAGE;
  const target = 0.84 * Math.min(st.r - st.l, st.b - st.t);
  const d = (2 * RB * H / Math.max(60, target)) / (2 * Math.tan(camera.fov * Math.PI / 360));
  const ce = Math.cos(ORB.el);
  const dir = new THREE.Vector3(Math.sin(ORB.az)*ce, Math.sin(ORB.el), Math.cos(ORB.az)*ce);
  aimFor(ball.position, dir, d, wantPos, wantAim);
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
/* The filter bar is fixed: what a sound is, not how it was tagged. FIELD recordings, SAMPLES
   (processed clips: PS-1 loops, files you open), STRIP (SLUICE stems), KIT (FATHOM kits),
   WAVES (LATHE wavetables). Tags stay on the row and in search. */
const CATS = ['FIELD', 'SAMPLES', 'STRIP', 'KIT', 'WAVES'];
const CAT_OF_TOOL = {field: 'FIELD', ps1: 'SAMPLES', sluice: 'STRIP', fathom: 'KIT', lathe: 'WAVES'};
/* A shelf sidecar may say which it is ("category": "kit" and so on), for a tool that keeps more than one
   kind of sound. Without it, or with a word ADIT doesn't know, the tool's folder decides. */
function catOfShelf(j, tool){
  const c = String(j.category || '').toUpperCase();
  return CATS.includes(c) ? c : (CAT_OF_TOOL[tool] || 'SAMPLES');
}
/* An archive core says which it is ("category"); an older manifest without it is read from its tags. */
function catOfManifest(e){
  const c = String(e.category || '').toUpperCase();
  if (CATS.includes(c)) return c;
  const t = (e.tags || []).map(x => String(x).toLowerCase());
  if (t.includes('kit')) return 'KIT';
  if (t.includes('wavetable') || t.includes('waves')) return 'WAVES';
  if (t.includes('stem') || t.includes('strip')) return 'STRIP';
  if (t.includes('sample') || t.includes('samples') || t.includes('loop')) return 'SAMPLES';
  return 'FIELD';
}
function filtered(){
  const q = S.query;
  return S.entries.map((e,i) => ({e,i})).filter(({e}) =>
    (S.seam === 'ALL' || e.cat === S.seam) &&
    (!q || (e.title + ' ' + (e.tags||[]).join(' ') + ' ' + (e.cat||'') + ' ' + (e.notes||'') + ' ' + (e.id||''))
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
  search:$('#search'), dl:$('#k-dl'), send:$('#sendkeys'), sendrow:$('#sendrow'), link:$('#k-link'), zone:$('#loopzone'), rgn:$('#rgn'), mm:[$('#mm-l > u'), $('#mm-r > u')], tabs:$('#tabs'),
  actrow:$('#actrow'), monrow:$('#monrow')
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
    // all six, always, so the bar never shifts; a category with nothing in it yet is there but off
    const n = {ALL: S.entries.length};
    for (const e of S.entries) n[e.cat] = (n[e.cat] || 0) + 1;
    el.filter.innerHTML = ['ALL', ...CATS].map(s =>
      `<button type="button" data-seam="${s}" aria-pressed="${s===S.seam}"${n[s] || s === S.seam ? '' : ' disabled'}` +
      ` title="${s} · ${n[s] || 0}">${s}</button>`).join('');
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
    if (!marking) UI.actions();
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
    for (const b of el.send.querySelectorAll('button')) b.disabled = !has || S.busy;
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

  /* THIS SOUND: rename and delete (anything in the library, never the archive), and the two ways of
     keeping a new sound from this one: the marked A/B, and what you hear at the receiver. */
  actions(){
    const e = S.entries[S.current];
    const has = !!(LIB && e && A.buffer && !S.busy);
    const rgn = S.rgnA != null && S.rgnB > S.rgnA;
    const keys = [];
    if (has && e.local) keys.push(['rename', 'Rename'], ['delete', 'Delete']);
    if (has && rgn) keys.push(['keepab', 'Keep A/B']);
    if (has && ambiOn()) keys.push(['keepheard', rgn ? 'Keep A/B as heard' : 'Keep what you hear']);
    el.actrow.hidden = !keys.length;
    if (!keys.length){ delete el.actrow.dataset.mode; return; }
    if (el.actrow.dataset.mode === 'rename') return;       // leave the field alone while you type
    el.actrow.innerHTML = '<span>This sound</span>' + keys.map(([a, t]) =>
      `<button class="act" type="button" data-act="${a}">${t}</button>`).join('');
  },

  /* LISTEN AS: only for files with more than two channels */
  monitor(){
    const n = MON.n;
    el.monrow.hidden = !(n > 2);
    if (n > 2){
      const modes = n === 4 && MON.dec.length ? [['mix','Mix'], ['ambix','AmbiX'], ['fuma','FuMa']].map(([m, t]) =>
        `<button class="act" type="button" data-mon="${m}" aria-pressed="${MON.mode === m}">${t}</button>`).join('') : '';
      const chans = MON.mode === 'mix' && n <= 16 ? MON.on.map((on, c) =>
        `<button class="act ch" type="button" data-ch="${c}" aria-pressed="${on}" title="Channel ${c+1}">${c+1}</button>`).join('') : '';
      el.monrow.innerHTML = `<span>${n} ch · listen as</span>${modes}${chans}`;
    }
  },

  stamp(e){
    if (!e){
      el.stamp.className = 'on';
      el.stTitle.textContent = S.entries.length ? (LIB ? 'Your library' : 'Select a core')
        : LIB ? 'Nothing here yet' : LOG_MODE ? 'No manifest loaded' : 'Archive unavailable';
      el.stMeta.innerHTML = LIB
        ? 'Everything FIELD recorded, PS-1 kept and you opened here, then the Wasteland Props archive.<br>Read it, mark A/B, send it on. Nothing leaves this device.'
        : S.entries.length
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
    /* Plain text, always: in the library a note or a title can come from a file name or from another
       tool's sidecar, and this origin holds every Workbench tool's files. */
    el.stMeta.innerHTML =
      (e.notes ? esc(e.notes) + '<br>' : '') +
      `<span style="color:var(--ash-lo)">${esc(bits.join('  ·  '))}</span>` +
      (e.license ? `<br><span style="color:var(--ash-lo)">USE ${esc(e.license)}</span>` : '');
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
  if (e.handle){ const f = await Library.fileOf(e); return {buf: await f.arrayBuffer(), size: f.size}; }
  if (e.make){ const buf = await e.make(); return {buf, size: buf.byteLength}; }
  if (e.raw) return {buf: e.raw, size: e.raw.byteLength};
  const r = await fetch(e.url, {mode:'cors'});
  if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + e.url);
  const buf = await r.arrayBuffer();
  return {buf, size: buf.byteLength};
}

/* Pull the next core's bytes while this one plays, so chaining is seamless. */
async function prefetch(i){
  const e = S.entries[i];
  if (!e || e.file || e.raw || e.decoded || e.failed || e.handle || e.make) return;
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
  byAge(e => e.raw && !e.file && !e.handle).slice(KEEP_RAW).forEach(x => {
    if (x.i !== S.current) x.e.raw = null; });
}

async function selectEntry(i, opt = {}){
  const e = S.entries[i];
  if (!e || S.busy) return;
  stop();
  S.current = i; S.busy = true; e.touched = performance.now();
  clearRegion(); UI.actions();
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
    const nch = d.ab.numberOfChannels;
    MON.on = Array.from({length: nch}, () => true); MON.yaw = 0; MON.pitch = 0; MON.pos = [0, 0, 0];
    MON.mode = nch === 4 && AMBI_RE.test(e.title + ' ' + nameOf(e)) ? 'ambix' : 'mix';
    buildMonitor(nch);
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
    UI.rows(); UI.ruler(); UI.transport(); UI.region(); UI.actions(); UI.monitor();
    if (ambiOn()){ buildField(e.log, MON.mode); setView('space'); }
    else if (S.view === 'space') setView('read');
    frameRead();
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
    else if (e.handle) blob = await Library.fileOf(e);
    else if (e.make) blob = new Blob([await e.make()], {type:'audio/wav'});
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
let dragging = false, hoverInst = -1, dragY = 0, dragT = 0, turnX = 0, turning = false;
let spaceDrag = null, turnY = 0;
const dragPlane = new THREE.Plane(), _hit = new THREE.Vector3();
function moveReceiver(){
  ray.setFromCamera(ndc, camera);
  if (!ray.ray.intersectPlane(dragPlane, _hit)) return;
  ball.worldToLocal(_hit);
  let [x, y, z] = T2A(_hit.divideScalar(RB));
  const r = Math.hypot(x, y, z);
  if (r > POS_MAX){ x *= POS_MAX/r; y *= POS_MAX/r; z *= POS_MAX/r; }
  MON.pos = [x, y, z];
  if (r > 0.08 * POS_MAX){ MON.yaw = Math.atan2(y, x); MON.pitch = Math.asin(clamp(z / Math.max(r, 1e-6), -1, 1)); }
  setMonitor();
  el.hint.textContent = 'Receiver ' + heardLabel();
}

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
  turnX = ev.clientX; turnY = ev.clientY;
  // SPACE: grab the receiver if the finger lands on it, otherwise swing round the ball
  if (S.view === 'space'){
    ray.setFromCamera(ndc, camera);
    if (ray.intersectObject(rcvPick, false)[0]){
      rcv.getWorldPosition(_hit);
      dragPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(_q2), _hit);
      spaceDrag = 'rcv';
    } else spaceDrag = 'orbit';
    renderer.domElement.setPointerCapture(ev.pointerId);
    return;
  }
  // inside the core there is nothing to aim at: up and down travel through time, sideways turns
  if (S.view === 'dive'){
    if (A.buffer){ dragging = true; dragY = ev.clientY; dragT = position(); renderer.domElement.setPointerCapture(ev.pointerId); }
    return;
  }
  if (S.view === 'read' && seekFromRay()){
    dragging = true; dragY = ev.clientY; dragT = position();
    renderer.domElement.setPointerCapture(ev.pointerId);
    return;
  }
  // a finger has no hover, so ask the rack directly
  ray.setFromCamera(ndc, camera);
  const hit = rack.count ? ray.intersectObject(rack, false)[0] : null;
  if (hit && S.entries[hit.instanceId]){ selectEntry(hit.instanceId); return; }
  turning = true; renderer.domElement.setPointerCapture(ev.pointerId);
});
renderer.domElement.addEventListener('pointermove', ev => {
  setNdc(ev);
  if (spaceDrag === 'rcv'){ moveReceiver(); return; }
  if (spaceDrag === 'orbit'){
    ORB.az -= (ev.clientX - turnX) * 0.008; ORB.el = clamp(ORB.el + (ev.clientY - turnY) * 0.006, -1.25, 1.25);
    turnX = ev.clientX; turnY = ev.clientY; return;
  }
  if (dragging && S.view === 'dive'){
    const perPx = A.buffer.duration / Math.max(240, innerHeight * 1.4);
    seek(dragT - (ev.clientY - dragY) * perPx);      // pull the tunnel toward you to go deeper
    spin += (ev.clientX - turnX) * 0.006; turnX = ev.clientX;
    return;
  }
  if (turning){ spin += (ev.clientX - turnX) * 0.008; turnX = ev.clientX; return; }
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
addEventListener('pointerup', () => { dragging = false; turning = false; spaceDrag = null; });
addEventListener('pointercancel', () => { dragging = false; turning = false; spaceDrag = null; });
renderer.domElement.addEventListener('dblclick', () => {
  if (S.view !== 'space') return;
  MON.pos = [0, 0, 0]; MON.yaw = 0; MON.pitch = 0; setMonitor();
  el.hint.textContent = 'Receiver back at the centre, facing front';
});

addEventListener('touchmove', ev => {
  if (ev.touches && ev.touches.length > 1) return;   // leave pinch-zoom alone
  const t = ev.target;
  if (t instanceof Element && t.closest('#rows, #tools')) return;   // lists that scroll themselves
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
    UI.actions();                                   // KEEP A/B appears once the region is let go
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
/* READ → DIVE → RACK. DIVE puts the camera inside the core just above the read head and keeps it
   there: the strata come up at you as the recording plays, the live spectrum is the ring at your feet. */
const VIEW_HINT = {
  space: 'Space · drag the teal receiver toward a sound, drag around it to orbit, double-click to recentre',
  read: 'Read head · drag the core to seek, drag beside it to turn',
  dive: 'Dive · riding the read head — drag up or down to travel, sideways to turn',
  rack: 'Rack · tap a core to load it'
};
const viewsNow = () => ambiOn() ? ['space', ...VIEW_ORDER] : VIEW_ORDER;
function setView(v){
  S.view = v; document.body.dataset.view = v;
  if (v === 'read' || v === 'rack'){ wantPos.copy(VIEWS[v].p); wantAim.copy(VIEWS[v].a); }
  const k = $('#k-view'), list = viewsNow();
  k.textContent = {space:'◍', read:'◱', dive:'◎', rack:'▤'}[v];
  k.setAttribute('aria-pressed', String(v !== 'read'));
  const nx = list[(list.indexOf(v) + 1) % list.length];
  k.title = 'View: ' + v.toUpperCase() + ' — next ' + nx.toUpperCase() + ' (V)';
  el.hint.textContent = VIEW_HINT[v];
  frameRead();
}
$('#k-view').onclick = () => { const l = viewsNow(); setView(l[(l.indexOf(S.view) + 1) % l.length]); };
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

/* rename and delete, for the sound on the head */
let armTimer = null;
async function commitRename(){
  const e = S.entries[S.current], inp = $('#rn');
  if (!e || !inp) return;
  const t = inp.value.trim().replace(/\s+/g, ' ').slice(0, 80);
  delete el.actrow.dataset.mode;
  if (t && t.toUpperCase() !== e.title){
    try {
      if (e.src) await Library.rename(e, t);
      e.title = t.toUpperCase(); e.given = t;
      UI.rows(); UI.stamp(e); el.hint.textContent = 'Renamed';
    } catch (err){ el.hint.textContent = 'Could not rename — ' + (err.message || err); }
  }
  UI.actions();
}
function dropEntry(i){
  if (!S.entries[i]) return;
  if (i === S.current){
    stop(); A.buffer = null; S.current = -1; MON.n = 0;
    if (coreLines){ head.remove(coreLines); coreLines.geometry.dispose(); coreLines = null; }
    if (pickMesh){ head.remove(pickMesh); pickMesh.geometry.dispose(); pickMesh = null; }
    UI.stamp(null);
  } else if (i < S.current) S.current--;
  S.entries.splice(i, 1);
  layoutRack(S.entries.length);
  const cur = S.entries[S.current];
  if (cur && cur.log){ let cs = 0, es = 0;
    for (let k = 0; k < SLICES; k++){ cs += cur.log.cen[k]*cur.log.rmsN[k]; es += cur.log.rmsN[k]; }
    tintRack(S.current, mineral(es > 0 ? cs/es : 400, 0.55).clone()); }
  UI.filters(); UI.rows(); UI.ruler(); UI.transport(); UI.actions(); UI.monitor();
  if (LIB) libCount();
  frameRead();
}
el.actrow.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const i = S.current, e = S.entries[i]; if (!e) return;
  const act = b.dataset.act;
  if (act === 'rename'){
    el.actrow.dataset.mode = 'rename';
    el.actrow.innerHTML = `<input id="rn" type="text" maxlength="80" enterkeyhint="done" autocomplete="off"
      aria-label="New name" value="${esc(e.given || e.title)}">` +
      '<button class="act" type="button" data-act="save">Save</button>' +
      '<button class="act" type="button" data-act="cancel">Cancel</button>';
    const inp = $('#rn'); inp.focus(); inp.select();
    return;
  }
  if (act === 'cancel'){ delete el.actrow.dataset.mode; UI.actions(); return; }
  if (act === 'keepab' || act === 'keepheard'){ keepCut(act === 'keepheard' ? 'heard' : 'ab'); return; }
  if (act === 'save'){ commitRename(); return; }
  if (act === 'delete'){
    if (!b.classList.contains('armed')){            // two taps, no dialog: the second one deletes
      b.classList.add('armed'); b.textContent = 'Tap again to delete';
      clearTimeout(armTimer); armTimer = setTimeout(() => UI.actions(), 5000);
      return;
    }
    clearTimeout(armTimer);
    try {
      if (e.src) await Library.remove(e);
      dropEntry(i);
      el.hint.textContent = 'Deleted ' + e.title;
    } catch (err){ el.hint.textContent = 'Could not delete — ' + (err.message || err); UI.actions(); }
  }
});
el.actrow.addEventListener('keydown', ev => {
  if (ev.target.id !== 'rn') return;
  if (ev.key === 'Enter'){ ev.preventDefault(); commitRename(); }
  if (ev.key === 'Escape'){ delete el.actrow.dataset.mode; UI.actions(); }
});
/* A new sound from this one, kept in the library beside it: the A/B region as recorded, or (for
   B-format) what you hear at the receiver, as stereo. Float in, float out; nothing clamped. */
let keeping = false;
async function keepCut(kind){
  const e = S.entries[S.current];
  if (!e || !A.buffer || keeping) return;
  const region = (S.rgnA != null && S.rgnB > S.rgnA) ? [S.rgnA, S.rgnB] : null;
  const span = region ? clock(region[0]).slice(3, 8) + '–' + clock(region[1]).slice(3, 8) : '';
  keeping = true;
  try {
    let chans, rate, title, tags, notes;
    if (kind === 'heard'){
      ({chans, rate} = await renderHeard(e, region));
      title = (e.given || e.title) + ' — heard ' + heardLabel().replace(' · ', ', ') + (span ? ' · ' + span : '');
      tags = ['heard', MON.mode]; notes = 'Binaural render of ' + (e.given || e.title) + ', receiver ' + heardLabel();
    } else {
      if (!region) return;
      el.hint.textContent = (e.masterUrl ? 'Pulling the float master · ' : '') + 'Cutting A/B';
      ({chans, rate} = await Library.samplesOf(e));
      const a = Math.max(0, Math.floor(region[0]*rate)), b = Math.ceil(region[1]*rate);
      chans = chans.map(c => c.subarray(a, b));
      title = (e.given || e.title) + ' — A/B ' + span; tags = ['cut']; notes = 'A/B ' + span + ' of ' + (e.given || e.title);
    }
    const file = new File([wavFloat(chans, rate)], title.replace(/[^\w.-]+/g, '-').slice(0, 60) + '.wav', {type: 'audio/wav'});
    await addFiles([file], {select: false, meta: {title, tags, notes, category: String(e.cat || 'FIELD').toLowerCase(),
      from: e.source || (e.id ? {tool: 'archive', id: e.id} : undefined)}});
  } catch (err){ el.hint.textContent = 'Could not keep it — ' + (err.message || err); }
  finally { keeping = false; }
}
el.monrow.addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.mon){
    MON.mode = b.dataset.mon;
    const cur = S.entries[S.current];
    if (MON.mode === 'mix'){ if (S.view === 'space') setView('read'); el.hint.textContent = 'Every channel you leave on, to both ears'; }
    else { buildField(cur && cur.log, MON.mode); setView('space'); }
    UI.actions();
  }
  if (b.dataset.ch){
    const c = +b.dataset.ch;
    MON.on[c] = !MON.on[c];
    if (!MON.on.some(Boolean)) MON.on[c] = true;     // never all silent
  }
  setMonitor(); UI.monitor(); frameRead();
});

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
    case 'v': case 'V': $('#k-view').click(); break;
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

async function addFiles(files, opt = {}){
  const keep = [...files].filter(f => AUDIO_RE.test(f.name))
    .sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true}));
  if (!keep.length){ el.hint.textContent = 'No audio in that drop'; return; }
  const fresh = [];
  let kept = 0, missed = 0;
  for (const f of keep){
    const e = {
      title: f.name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').toUpperCase(),
      file: f, size: f.size, local: true, cat: LIB ? 'SAMPLES' : 'FIELD',
      tags: [(f._path || '').split('/').filter(Boolean).pop() || 'LOCAL'].map(t => t.toUpperCase().slice(0,12))
    };
    if (LIB){                                   // in Workbench a file you open is kept, so every tool can reach it
      if (keep.length > 1) el.hint.textContent = 'Keeping ' + (fresh.length + 1) + ' of ' + keep.length;
      const k = await Library.keep(f, opt.meta);
      if (k){ Object.assign(e, k); kept++; } else missed++;
    }
    fresh.push(e);
  }
  /* The log changes in one step, after every await, so a row clicked meanwhile still means what it showed. */
  let first;
  if (LIB){
    S.entries.unshift(...fresh.reverse());      // newest first, the order a reload will list them in
    if (S.current >= 0) S.current += fresh.length;   // the core on the head moved down with the rest
    first = 0;
    el.hint.textContent = opt.meta ? (kept ? 'Kept “' + fresh[0].title + '” in your library' : 'This browser cannot keep files')
      : kept ? 'Kept ' + kept + ' in your library' + (missed ? ' · ' + missed + ' could not be kept (this browser cannot write files)' : '')
             : 'Opened for now · this browser cannot keep files';
    libCount();
  } else {
    first = S.entries.length;
    S.entries.push(...fresh);
  }
  layoutRack(S.entries.length); UI.filters(); UI.rows();
  if (opt.select === false){
    const cur = S.entries[S.current];             // the rack was rebuilt: give the core on the head its colour back
    if (cur && cur.log){ let cs = 0, es = 0;
      for (let k = 0; k < SLICES; k++){ cs += cur.log.cen[k]*cur.log.rmsN[k]; es += cur.log.rmsN[k]; }
      tintRack(S.current, mineral(es > 0 ? cs/es : 400, 0.55).clone()); }
    return;
  }
  selectEntry(first);
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

/* ═══ LIBRARY — inside Public Workbench ══════════════════════════════════
   Every Workbench tool lives on one site, so they share one file store (OPFS). ADIT reads it and
   never changes another tool's files:
     recordings/<id>.json + .wav      FIELD's takes (finished ones only: a take still recording is locked)
     library/<id>/meta.json + audio.f32   PS-1's loops (32-bit float, left then right)
     shelf/<tool>/<id>.json + file    anything a tool keeps for the others (WORKBENCH.md, "The shelf")
   ADIT writes only shelf/adit/ (files you open here) and shelf/_handoff/ (a sound on its way to a tool). */
const Library = (() => {
  let root = null;
  const SHELF = 'shelf', OWN = 'adit', HANDOFF = '_handoff';
  async function opfs(){
    if (root) return root;
    try { root = navigator.storage && navigator.storage.getDirectory ? await navigator.storage.getDirectory() : null; }
    catch(_){ root = null; }
    return root;
  }
  async function sub(d, name, create){ try { return await d.getDirectoryHandle(name, {create: !!create}); } catch(_){ return null; } }
  async function readJson(h){ try { return JSON.parse(await (await h.getFile()).text()); } catch(_){ return null; } }
  /* Your own work is dated on your own clock: a take at 9 pm in Halifax is not tomorrow's. */
  const local = ms => { const t = new Date(ms); return isFinite(t) ? new Date(t - t.getTimezoneOffset() * 6e4).toISOString() : ''; };
  const day = ms => local(ms).slice(0, 10) || undefined;
  const up = (t, n=12) => String(t || '').toUpperCase().slice(0, n);
  const slug = t => String(t || 'sound').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'sound';
  const base = p => String(p).split('/').pop();

  /* Another tool's sidecar is read, never trusted: one that is half written or shaped differently is
     skipped on its own, and the rest of the library still lists. */
  async function field(r){
    const d = await sub(r, 'recordings'), out = [];
    if (!d) return out;
    for await (const [name, h] of d.entries()){
      try {
        if (h.kind !== 'file' || !name.endsWith('.json')) continue;
        const j = await readJson(h);
        if (!j || j.state !== 'done' || !j.file) continue;          // still recording, or never finished
        const m = j.meta || {}, id = j.id || name.slice(0, -5), at = Number(j.startMs);
        const where = m.location && isFinite(m.location.lat) && isFinite(m.location.lon)
          ? Number(m.location.lat).toFixed(4) + ' ' + Number(m.location.lon).toFixed(4) : undefined;
        out.push({
          id: 'FIELD-' + id, local: true, source: {tool: 'field', id},
          title: up(m.title || ('FIELD ' + (local(at).slice(0, 16).replace('T', ' ') || id)), 80),
          handle: {dir: d, name: base(j.file)}, dlName: slug(m.title || id) + '.wav',
          src: {kind: 'field', dir: d, json: name, audio: base(j.file)}, given: m.title || undefined,
          size: j.bytes, dur: j.durationSec, made: at || 0,
          cat: 'FIELD', tags: ['YOURS', 'FIELD'].concat(m.ucs && m.ucs.category ? [up(m.ucs.category)] : []),
          loc: where, date: day(at),
          notes: [m.place && m.place.name, m.notes].filter(Boolean).join(' · ') || undefined,
          license: 'Yours. Recorded with FIELD on this device.'
        });
      } catch(_){}
    }
    return out;
  }

  async function ps1(r){
    const d = await sub(r, 'library'), out = [];
    if (!d) return out;
    for await (const [id, h] of d.entries()){
      try {
        if (h.kind !== 'directory') continue;
        const m = await readJson(await h.getFileHandle('meta.json'));
        if (!m || !(m.frames > 0) || !(m.sampleRate > 0)) continue;  // meta.json is written last: no meta, not finished
        const made = Date.parse(m.made) || 0;
        out.push({
          id: 'PS1-' + id, local: true, source: {tool: 'ps1', id},
          title: up(m.name || 'PS-1 LOOP', 80), dlName: slug(m.name || id) + '.wav',
          src: {kind: 'ps1', dir: d, id}, given: m.name || undefined,
          make: async () => {
            const all = new Float32Array(await (await (await h.getFileHandle('audio.f32')).getFile()).arrayBuffer());
            const n = m.frames;                                  // left, then right, n frames each
            if (all.length >= 2 * n) return wavFloat([all.subarray(0, n), all.subarray(n, 2 * n)], m.sampleRate);
            if (all.length >= n) return wavFloat([all.subarray(0, n)], m.sampleRate);
            throw new Error('PS-1 loop is shorter than its meta says');
          },
          size: m.frames * 8 + 44, dur: m.frames / m.sampleRate, made,
          cat: 'SAMPLES', tags: ['YOURS', 'PS-1', 'LOOP'], date: made ? day(made) : undefined,
          notes: [m.bars ? m.bars + ' bars' : '', m.bpm ? m.bpm + ' BPM' : ''].filter(Boolean).join(' · ') || undefined,
          license: 'Yours. Kept by PS-1 on this device.'
        });
      } catch(_){}
    }
    return out;
  }

  async function shelf(r){
    const s = await sub(r, SHELF), out = [];
    if (!s) return out;
    for await (const [tool, d] of s.entries()){
      if (d.kind !== 'directory' || tool === HANDOFF) continue;
      try {
        for await (const [name, h] of d.entries()){
          try {
            if (h.kind !== 'file' || !name.endsWith('.json')) continue;
            const j = await readJson(h);
            if (!j || !j.file) continue;                           // the sidecar is written last
            const made = Date.parse(j.made) || 0, id = j.id || name.slice(0, -5);
            out.push({
              id: 'SHELF-' + tool + '-' + id, local: true, source: {tool, id},
              title: up(j.title || j.file, 80), handle: {dir: d, name: base(j.file)}, dlName: base(j.file),
              src: {kind: 'shelf', dir: d, json: name, audio: base(j.file)}, given: j.title || undefined,
              size: j.bytes, dur: j.durationSec, made, date: made ? day(made) : undefined,
              cat: catOfShelf(j, tool),
              tags: ['YOURS', up(tool === OWN ? (j.from ? 'KEPT' : 'OPENED') : tool)].concat((Array.isArray(j.tags) ? j.tags : []).map(t => up(t))),
              notes: j.notes ? String(j.notes) : undefined,
              license: tool === OWN ? 'Opened from your files and kept here.' : 'Yours. Made with ' + up(tool) + ' on this device.'
            });
          } catch(_){}
        }
      } catch(_){}
    }
    return out;
  }

  /* Never throws: a library that cannot be read is an empty one, and the archive still loads. */
  async function scan(){
    const r = await opfs();
    if (!r) return [];
    const safe = async f => { try { return await f(r); } catch(_){ return []; } };
    const all = [].concat(await safe(field), await safe(ps1), await safe(shelf));
    return all.sort((a, b) => (b.made || 0) - (a.made || 0));
  }

  async function fileOf(e){ return (await e.handle.dir.getFileHandle(e.handle.name)).getFile(); }

  async function write(dir, name, data){
    const fh = await dir.getFileHandle(name, {create: true});
    const w = await fh.createWritable();                         // Safari 26+, Chrome, Firefox
    await w.write(data); await w.close();
  }
  /* Keep a file you opened: shelf/adit/<id>.<ext> plus its sidecar. Null where this browser can't write. */
  async function keep(f, meta){
    let d = null, id = '', file = '';
    try {
      const r = await opfs(); if (!r) return null;
      d = await sub(await sub(r, SHELF, true), OWN, true); if (!d) return null;
      id = Date.now().toString(36) + '-' + (f.size >>> 0).toString(36);
      const ext = (/\.([a-z0-9]{2,5})$/i.exec(f.name) || [, 'wav'])[1].toLowerCase();
      file = id + '.' + ext;
      await write(d, file, f);
      const now = Date.now();
      const j = {v: 1, tool: OWN, id, title: (meta && meta.title) || f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
                 file, bytes: f.size, made: new Date(now).toISOString(), notes: (meta && meta.notes) || 'Opened from ' + f.name};
      if (meta){ if (meta.tags) j.tags = meta.tags; if (meta.category) j.category = meta.category; if (meta.from) j.from = meta.from; }
      await write(d, id + '.json', JSON.stringify(j));               // written last: no sidecar, not listed
      return {handle: {dir: d, name: file}, dlName: f.name, title: up(j.title, 80),
              tags: ['YOURS', meta ? 'KEPT' : 'OPENED'].concat((j.tags || []).map(t => up(t))),
              cat: meta ? catOfShelf(j, OWN) : 'SAMPLES',
              src: {kind: 'shelf', dir: d, json: id + '.json', audio: file}, given: j.title, source: {tool: OWN, id},
              made: now, date: day(now), notes: j.notes,
              license: meta ? 'Made in ADIT on this device.' : 'Opened from your files and kept here.'};
    } catch(_){
      /* Where getFileHandle works but createWritable does not (Safari before 26) an empty file is left
         behind. It is ours, in shelf/adit/, so take it back out. */
      if (d && file){ await d.removeEntry(file).catch(() => {}); await d.removeEntry(id + '.json').catch(() => {}); }
      return null;
    }
  }

  /* The samples to hand on, as floats. An archive core streams as FLAC, which is integer and has already
     lost the headroom above 0 dBFS, so its float master is read instead: the same file the download gives. */
  async function samplesOf(e){
    let buf;
    if (e.masterUrl){
      const res = await fetch(e.masterUrl, {mode: 'cors'});
      if (!res.ok) throw new Error('float master: HTTP ' + res.status);
      buf = await res.arrayBuffer();
    } else if (e.decoded) return {chans: e.decoded.chans, rate: e.decoded.rate};
    else buf = (await bytesFor(e)).buf;
    if (sniff(buf) === 'wav'){ const w = parseWav(buf); return {chans: w.channels, rate: w.rate}; }
    const d = await decode(buf, e.title);
    return {chans: d.chans, rate: d.rate};
  }

  /* Hand a sound to another tool: write it to shelf/_handoff/ as 32-bit float WAV (the A/B region only, if
     one is marked), leave a note in localStorage, open the tool. The tool reads the note (WORKBENCH.md,
     "Handing a sound on"). Old hand-offs are cleared on load. */
  async function handoff(to, e, region, heard){
    const r = await opfs(); if (!r) throw new Error('this browser has no file store');
    const {chans, rate} = heard || await samplesOf(e);              // a render arrives already cut to A/B
    let cut = chans, name = slug(e.title).toLowerCase() + (heard ? '-heard' : '');
    if (region){
      const a = Math.max(0, Math.floor(region[0] * rate)), b = Math.ceil(region[1] * rate);
      if (!heard) cut = chans.map(c => c.subarray(a, b));
      name += '-' + region[0].toFixed(2) + '-' + region[1].toFixed(2);
    }
    if (!cut.length || !cut[0].length) throw new Error('nothing to send in that region');
    const data = wavFloat(cut, rate);
    name += '.wav';
    const d = await sub(await sub(r, SHELF, true), HANDOFF, true);
    if (!d) throw new Error('could not open the shelf');
    const file = Date.now().toString(36) + '-' + name;
    await write(d, file, data);
    const note = {v: 1, to, file: SHELF + '/' + HANDOFF + '/' + file, name, title: heard ? e.title + ' — HEARD' : e.title,
                  from: {tool: 'adit', source: e.source || (e.id ? {tool: 'archive', id: e.id} : null)},
                  region: region || null, bytes: data.byteLength, at: Date.now()};
    localStorage.setItem('wb.handoff', JSON.stringify(note));
    return note;
  }
  async function sweep(){
    try {
      const r = await opfs(); if (!r) return;
      const s = await sub(r, SHELF); if (!s) return;
      const d = await sub(s, HANDOFF); if (!d) return;
      const old = Date.now() - 86400e3, gone = [];
      for await (const [name, h] of d.entries()){
        const t = parseInt(name.split('-')[0], 36);
        if (h.kind === 'file' && isFinite(t) && t < old) gone.push(name);
      }
      for (const n of gone) await d.removeEntry(n).catch(() => {});
    } catch(_){}
  }

  /* Which tools take a sound handed to them: Workbench's build reads each tool's accepts-audio meta tag
     (WORKBENCH.md, "Handing a sound on") into wb/build.json. */
  let takers = null;
  async function accepting(){
    if (takers) return takers;
    try { const b = await (await fetch('../wb/build.json', {cache: 'no-store'})).json();
          takers = (Array.isArray(b.tools) ? b.tools : [])
            .filter(t => t && t.accepts === true && t.id && t.id !== OWN)
            .map(t => ({id: String(t.id), name: String(t.name || t.id).toUpperCase()})); }
    catch(_){ takers = []; }
    return takers;
  }

  /* Rename and delete reach every tool's sound (WORKBENCH.md, "Rename and delete"). A rename rewrites
     one field of the owner's own sidecar, read fresh so nothing else in it is lost: FIELD meta.title,
     PS-1 name, shelf title. A delete takes the sidecar first, so the sound is unlisted the moment
     anything goes, then the audio. Every tool already treats a missing sidecar as "not there". */
  async function rename(e, title){
    const s = e.src; if (!s) throw new Error('not a library file');
    if (s.kind === 'ps1'){
      const d = await s.dir.getDirectoryHandle(s.id);
      const m = await readJson(await d.getFileHandle('meta.json'));
      if (!m) throw new Error('its meta.json could not be read');
      m.name = title; await write(d, 'meta.json', JSON.stringify(m));
      return;
    }
    const j = await readJson(await s.dir.getFileHandle(s.json));
    if (!j) throw new Error('its sidecar could not be read');
    if (s.kind === 'field'){ j.meta = j.meta || {}; j.meta.title = title; } else j.title = title;
    await write(s.dir, s.json, JSON.stringify(j));
  }
  async function remove(e){
    const s = e.src; if (!s) return;
    if (s.kind === 'ps1'){ await s.dir.removeEntry(s.id, {recursive: true}); return; }
    await s.dir.removeEntry(s.json);
    await s.dir.removeEntry(s.audio).catch(() => {});
  }

  return {scan, fileOf, keep, handoff, sweep, accepting, rename, remove, samplesOf};
})();

/* A 32-bit float WAV, exactly the samples given: nothing clamped, nothing dithered. */
function wavFloat(chans, rate){
  const n = chans[0].length, ch = chans.length, data = n * ch * 4;
  const buf = new ArrayBuffer(44 + data), v = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, ch, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 4, true); v.setUint16(32, ch * 4, true); v.setUint16(34, 32, true);
  str(36, 'data'); v.setUint32(40, data, true);
  const out = new Float32Array(buf, 44, n * ch);
  for (let i = 0, k = 0; i < n; i++) for (let c = 0; c < ch; c++) out[k++] = chans[c][i];
  return buf;
}

/* The collection line, inside Workbench: how much of the log is yours, how much is the archive's. */
function libCount(){
  const yours = S.entries.filter(e => e.local).length;
  el.coll.textContent = yours + ' YOURS · ' + (S.entries.length - yours) + ' ARCHIVE';
}

/* SEND: hand the core on the head, or its marked A/B region, to a tool that takes sound. */
let sending = false;
async function sendTo(tool){
  if (!tool || sending) return;
  const e = S.entries[S.current];
  if (!e || !A.buffer){ el.hint.textContent = 'Pick a core to send'; return; }
  if (S.busy){ el.hint.textContent = 'Still logging · send it once the core is read'; return; }
  const region = (S.rgnA != null && S.rgnB > S.rgnA) ? [S.rgnA, S.rgnB] : null;
  el.hint.textContent = (e.masterUrl ? 'Pulling the float master · ' : '')
    + 'Handing ' + (region ? 'A/B of ' : '') + e.title + ' to ' + tool.name;
  sending = true;
  try {
    // B-format goes on as what you hear at the receiver: that is what the position is for
    const heard = ambiOn() ? await renderHeard(e, region) : null;
    await Library.handoff(tool.id, e, region, heard);
    location.href = '../' + encodeURIComponent(tool.id) + '/?handoff';   // a sibling folder: ADIT is at /adit/ in Workbench
  } catch (err){
    sending = false;
    el.hint.textContent = 'Could not hand it on — ' + (err.message || err);
  }
}

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
      tags: (LIB ? ['ARCHIVE'] : []).concat((e.tags || []).map(t => t.toUpperCase())), cat: catOfManifest(e),
      loc: e.loc, date: e.date, notes: e.notes, license: e.license, id: e.id
    }));
    el.coll.textContent = S.collection;
  } catch (err){
    el.coll.textContent = 'NO MANIFEST';
    el.hint.textContent = 'archive.json not found';
  }
  if (LIB){
    Library.sweep();
    const mine = await Library.scan();
    S.entries = mine.concat(S.entries);
    S.collection = 'YOUR LIBRARY';
    const k = document.querySelector('#stamp .k'); if (k) k.textContent = 'Public Workbench — Library';
    const lab = el.coll.previousElementSibling; if (lab) lab.textContent = 'LIBRARY';
    libCount();
    const takers = await Library.accepting();
    el.send.innerHTML = takers.map(t => `<button class="snd" type="button" data-to="${esc(t.id)}" disabled>${esc(t.name)}</button>`).join('');
    el.sendrow.hidden = !takers.length;
    el.send.onclick = ev => { const b = ev.target.closest('[data-to]'); if (b) sendTo(takers.find(t => t.id === b.dataset.to)); };
  }
  layoutRack(S.entries.length);
  UI.filters(); UI.rows(); UI.stamp(null);
  el.hint.textContent = LIB
    ? (S.entries.some(e => e.local) ? 'Your recordings, loops and kept files, then the archive' : 'Nothing kept yet · record in FIELD or open a file')
    : S.entries.length
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
  if (S.view === 'space'){
    if (!spaceDrag && !REDUCED) ORB.az += dt * 0.05;          // a slow walk round, until you take hold
    frameSpace();
    updateField(f, A.buffer ? A.buffer.duration : 1);
  }
  ball.visible = S.view === 'space';
  rackGrp.visible = S.view !== 'space';

  // DIVE: ride just above the read head, looking down and a little ahead into what is coming
  if (S.view === 'dive'){
    const kk = head.scale.x, y = head.position.y + (COL_H/2 - f*COL_H) * kk;
    wantPos.set(COL_X, y + 0.62*kk, 0.02);
    wantAim.set(COL_X, y - 2.2*kk, 0.42*kk);
  }

  // camera: eased, with a hand's-width of pointer parallax (none inside the core)
  const k = REDUCED ? 1 : 1 - Math.pow(0.0015, dt);
  const par = S.view === 'dive' || S.view === 'space' ? 0 : PARALLAX;
  camPos.lerp(wantPos, k); camAim.lerp(wantAim, k);
  camera.position.copy(camPos).add(new THREE.Vector3(pointer.x*0.30*par, pointer.y*0.20*par, 0));
  camera.lookAt(camAim);

  // the core turns slowly, and holds still while you are reading a depth or turning it by hand
  if (!dragging && !turning && !REDUCED) spin += dt * 0.085;
  head.rotation.y = spin;
  head.visible = S.view !== 'rack' && S.view !== 'space';   // the specimen steps aside for the rack and the ball

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
  if (LIB) window.__adit.library = {S, Library, sendTo, MON, meters, setMonitor, renderHeard};   // for end-to-end tests
  boot('ready');
  setTimeout(() => $('#boot').classList.add('done'), 900);
})();
