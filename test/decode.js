/* Container and analysis tests, run against the module inside the shipped
   public/index.html — not the sources, so a broken build cannot pass.

   node test/decode.js                                                        */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, moduleOf } from '../build/make.mjs';

/* mineral() wants a THREE.Color; nothing else in the DSP touches three */
const STUB = `
const THREE = {Color: class {
  constructor(h=0){ this.setHex(h); }
  setHex(h){ this.r=((h>>16)&255)/255; this.g=((h>>8)&255)/255; this.b=(h&255)/255; return this; }
  copy(c){ this.r=c.r; this.g=c.g; this.b=c.b; return this; }
  lerp(c,t){ this.r+=(c.r-this.r)*t; this.g+=(c.g-this.g)*t; this.b+=(c.b-this.b)*t; return this; }
  multiplyScalar(s){ this.r*=s; this.g*=s; this.b*=s; return this; }
}};`;

const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
const dsp = moduleOf(html).split('/* ═══ AUDIO ENGINE')[0]
  .replace("import * as THREE from 'three';", STUB)
  + '\nexport {parseWav, parseFlacInfo, logCore, fft, SLICES, NB};';

const { parseWav, parseFlacInfo, logCore, SLICES, NB } =
  await import('data:text/javascript;base64,' + Buffer.from(dsp).toString('base64'));

let n = 0, failed = 0;
const ok = (c, m) => { console.log(`  ${c?'PASS':'FAIL'}  ${String(++n).padStart(2,'0')}  ${m}`); if (!c) failed++; };

/* ─ build WAVs of every shape the archive is allowed to contain ─ */
function wav({rate=96000, ch=2, bits=32, float=true, ext=false, secs=0.6, rf64=false, hot=false}){
  const frames = Math.round(rate*secs), bp = bits>>3;
  const fmtSize = ext ? 40 : 16, dataSize = frames*ch*bp;
  const buf = new ArrayBuffer(12 + 8+fmtSize + 8+dataSize + (rf64 ? 8+28 : 0));
  const dv = new DataView(buf); let p = 0;
  const tag = t => { for (const c of t) dv.setUint8(p++, c.charCodeAt(0)); };
  tag(rf64 ? 'RF64' : 'RIFF'); dv.setUint32(p, rf64 ? 0xFFFFFFFF : buf.byteLength-8, true); p+=4; tag('WAVE');
  if (rf64){
    tag('ds64'); dv.setUint32(p,28,true); p+=4;
    dv.setBigUint64(p, BigInt(buf.byteLength-8), true); p+=8;
    dv.setBigUint64(p, BigInt(dataSize), true); p+=8;
    dv.setBigUint64(p, BigInt(frames), true); p+=8; dv.setUint32(p,0,true); p+=4;
  }
  tag('fmt '); dv.setUint32(p,fmtSize,true); p+=4;
  dv.setUint16(p, ext ? 0xFFFE : (float?3:1), true); p+=2;
  dv.setUint16(p,ch,true); p+=2; dv.setUint32(p,rate,true); p+=4;
  dv.setUint32(p,rate*ch*bp,true); p+=4; dv.setUint16(p,ch*bp,true); p+=2; dv.setUint16(p,bits,true); p+=2;
  if (ext){ dv.setUint16(p,22,true); p+=2; dv.setUint16(p,bits,true); p+=2; dv.setUint32(p,3,true); p+=4;
            dv.setUint16(p, float?3:1, true); p+=2; p+=14; }
  tag('data'); dv.setUint32(p, rf64 ? 0xFFFFFFFF : dataSize, true); p+=4;
  const start = p;
  for (let i = 0; i < frames; i++){
    const amp = (hot ? 1.9 : 0.8) * Math.exp(-i/frames*4);
    for (let c = 0; c < ch; c++){
      const v = (Math.random()*2-1) * amp * (c ? 0.7 : 1);
      const at = start + (i*ch+c)*bp;
      if (float && bits === 32) dv.setFloat32(at, v, true);
      else if (bits === 24){
        const q = Math.round(Math.max(-1,Math.min(1,v))*8388607);
        dv.setUint8(at,q&255); dv.setUint8(at+1,(q>>8)&255); dv.setInt8(at+2,q>>16);
      } else dv.setInt16(at, Math.round(Math.max(-1,Math.min(1,v))*32767), true);
    }
  }
  return buf;
}

let w = parseWav(wav({}));
ok(w.rate === 96000 && w.encoding === '32F' && w.channels.length === 2,
   `32-bit float 96k stereo → ${w.encoding} ${w.rate} Hz`);
ok(w.frames === Math.round(96000*0.6), `frame count ${w.frames}`);

w = parseWav(wav({ext:true, hot:true}));
let tp = 0; for (const c of w.channels) for (const v of c) tp = Math.max(tp, Math.abs(v));
ok(w.encoding === '32F', 'WAVE_FORMAT_EXTENSIBLE resolves its SubFormat');
ok(tp > 1.0, `float headroom survives the parser → peak ${tp.toFixed(3)} (>1.0)`);

w = parseWav(wav({bits:24, float:false, rate:48000}));
ok(w.encoding === '24I' && w.rate === 48000, `24-bit PCM 48k → ${w.encoding}`);
w = parseWav(wav({bits:16, float:false, rate:44100}));
ok(w.encoding === '16I' && Math.abs(w.channels[0][0]) <= 1, '16-bit PCM fast path');
w = parseWav(wav({rf64:true}));
ok(w.container === 'RF64' && w.frames > 0, `RF64 ds64 data size → ${w.frames} frames`);

/* ─ FLAC STREAMINFO: 96 kHz / 2 ch / 24-bit / 4 800 000 samples ─ */
const f = new ArrayBuffer(42), fv = new DataView(f);
'fLaC'.split('').forEach((c,i) => fv.setUint8(i, c.charCodeAt(0)));
fv.setUint32(4, 0x80000022, false);
fv.setUint16(8, 4096, false); fv.setUint16(10, 4096, false);
const total = 4800000;
fv.setUint32(18, (96000<<12) | (1<<9) | (23<<4) | Math.floor(total/4294967296), false);
fv.setUint32(22, total>>>0, false);
const fi = parseFlacInfo(f);
ok(fi && fi.rate === 96000 && fi.channels === 2 && fi.bits === 24 && fi.frames === total,
   `FLAC STREAMINFO → ${fi && [fi.rate,fi.channels+'ch',fi.bits+'bit',fi.frames].join(' / ')}`);
ok(parseFlacInfo(wav({secs:0.05})) === null, 'a WAV is not mistaken for FLAC');

/* ─ the core log: this is what the geometry is built from ─ */
const log = logCore(parseWav(wav({secs:2})).channels, 96000);
ok(log.rms.length === SLICES && log.bands.length === SLICES*NB,
   `core logged → ${SLICES} slices × ${NB} bands`);
ok(log.bandHz[0] < log.bandHz[NB-1] && log.bandHz[0] >= 30,
   `bands log-spaced ${log.bandHz[0].toFixed(0)} Hz → ${(log.bandHz[NB-1]/1000).toFixed(1)} kHz`);
let lo = 1, hi = 0;
for (const v of log.bands){ if (v < lo) lo = v; if (v > hi) hi = v; }
ok(lo >= 0 && hi <= 1 && hi > 0.8, `bands normalised into 0…1 (${lo.toFixed(2)}…${hi.toFixed(2)})`);
ok(log.rmsN[5] > log.rmsN[SLICES-5],
   `a decay narrows the core (${log.rmsN[5].toFixed(2)} → ${log.rmsN[SLICES-5].toFixed(2)})`);
ok(Math.abs(log.dur - 2) < 0.01, `duration ${log.dur.toFixed(3)} s`);

/* silence must read as silence, or the display is lying */
const quiet = logCore([new Float32Array(96000)], 96000);
ok(quiet.truePeak === 0 && quiet.rmsN.every(v => v === 0 || !isFinite(v) === false),
   'a silent core logs flat, not amplified');

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
