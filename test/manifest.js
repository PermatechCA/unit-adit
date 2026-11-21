/* archive.json is the only file a non-engineer edits, and a broken one looks
   exactly like a broken deploy: an empty core log and no error anywhere. This
   validates it against archive.schema.json before it can ship.

   node test/manifest.js                                                      */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../build/make.mjs';

let n = 0, failed = 0;
const ok = (c, m) => { console.log(`  ${c?'PASS':'FAIL'}  ${String(++n).padStart(2,'0')}  ${m}`); if (!c) failed++; };

const read = p => readFileSync(join(ROOT, p), 'utf8');
let manifest, schema;
try { manifest = JSON.parse(read('public/archive.json')); ok(true, 'archive.json is valid JSON'); }
catch (e){ ok(false, 'archive.json is valid JSON — ' + e.message); process.exit(1); }
try { schema = JSON.parse(read('public/archive.schema.json')); ok(true, 'archive.schema.json is valid JSON'); }
catch (e){ ok(false, 'archive.schema.json is valid JSON — ' + e.message); process.exit(1); }

/* enough of draft-07 for this schema: type, required, pattern, enum, additionalProperties */
function validate(node, sch, path, errs){
  if (sch.type === 'object'){
    if (typeof node !== 'object' || node === null || Array.isArray(node))
      return errs.push(`${path} should be an object`);
    for (const k of sch.required || [])
      if (!(k in node)) errs.push(`${path}.${k} is required`);
    for (const k of Object.keys(node)){
      const sub = (sch.properties || {})[k];
      if (!sub){ if (sch.additionalProperties === false) errs.push(`${path}.${k} is not a known field`); continue; }
      validate(node[k], sub, `${path}.${k}`, errs);
    }
  } else if (sch.type === 'array'){
    if (!Array.isArray(node)) return errs.push(`${path} should be an array`);
    node.forEach((v,i) => validate(v, sch.items, `${path}[${i}]`, errs));
  } else if (sch.type === 'string'){
    if (typeof node !== 'string') return errs.push(`${path} should be a string`);
    if (sch.pattern && !new RegExp(sch.pattern).test(node))
      errs.push(`${path} "${node}" does not match ${sch.pattern}`);
    if (sch.enum && !sch.enum.includes(node))
      errs.push(`${path} "${node}" is not one of ${sch.enum.join(', ')}`);
  }
}
const errs = [];
validate(manifest, schema, 'archive', errs);
ok(errs.length === 0, errs.length ? `schema — ${errs.join('; ')}` : `schema clean, ${manifest.entries.length} entries`);

/* ─ things a schema cannot express ─ */
const AUDIO = /\.(wav|flac|aif|aiff|w64|rf64)$/i;
const bad = manifest.entries.filter(e => !AUDIO.test(e.file));
ok(bad.length === 0, bad.length
  ? `lossy or unknown extensions: ${bad.map(e => e.file).join(', ')}`
  : 'every entry points at a lossless container');

/* file streams, master downloads — they must not be the same thing */
const withMaster = manifest.entries.filter(e => e.master);
const badMaster = withMaster.filter(e => !AUDIO.test(e.master));
ok(badMaster.length === 0, badMaster.length
  ? `masters not lossless: ${badMaster.map(e => e.master).join(', ')}`
  : `${withMaster.length} of ${manifest.entries.length} entries publish a separate master`);
ok(withMaster.every(e => e.master !== e.file),
   'no entry lists the same file as both stream and master');

/* the point of a master is headroom FLAC cannot carry, so it should be a WAV */
const oddPair = withMaster.filter(e => /\.flac$/i.test(e.master));
ok(oddPair.length === 0, oddPair.length
  ? `FLAC master defeats the purpose: ${oddPair.map(e => e.id || e.file).join(', ')}`
  : 'masters are PCM containers, not FLAC');

const ids = manifest.entries.map(e => e.id).filter(Boolean);
ok(new Set(ids).size === ids.length, 'core ids are unique — they are the deep-link keys');

const files = manifest.entries.map(e => e.file);
ok(new Set(files).size === files.length, 'no file is logged twice');

const relative = manifest.entries.some(e =>
  !/^https?:/i.test(e.file) || (e.master && !/^https?:/i.test(e.master)));
ok(!relative || !!manifest.base,
   relative ? `relative paths resolve against base "${manifest.base}"` : 'all paths absolute');

/* Two kinds of base. An https host (the R2 cache) for anything big. Or a relative folder beside the
   app, "audio/": same origin, no CORS, and it follows ADIT to /adit/ inside Workbench. A root path
   ("/audio/") would break there, and Workbench's build refuses them. */
const local = manifest.base && !/^https?:/i.test(manifest.base);
if (manifest.base && !local){
  ok(/^https:\/\//.test(manifest.base) && manifest.base.endsWith('/'),
     `base is an https host ending in a slash — "${manifest.base}"`);
  ok(!manifest.base.includes('adit.wastelandprops.com'),
     'base points at the cache host, not at the app origin');
}
if (local){
  ok(/^[a-z0-9][\w.-]*(\/[\w.-]+)*\/$/i.test(manifest.base) && !manifest.base.includes('..'),
     `base is a relative folder ending in a slash, no root path — "${manifest.base}"`);
  /* a missing file here deploys fine and plays as ERR; Cloudflare refuses any asset over 25 MiB */
  const paths = manifest.entries.flatMap(e => [e.file, e.master]).filter(p => p && !/^https?:/i.test(p));
  const missing = [], big = [];
  for (const p of paths){
    try { const st = statSync(join(ROOT, 'public', manifest.base, p)); if (st.size > 25 * 1024 * 1024) big.push(p); }
    catch (_){ missing.push(p); }
  }
  ok(missing.length === 0, missing.length ? `missing from public/${manifest.base}: ${missing.join(', ')}`
                                          : `all ${paths.length} files present in public/${manifest.base}`);
  ok(big.length === 0, big.length ? `over Cloudflare's 25 MiB asset cap, move to R2: ${big.join(', ')}`
                                  : 'every file under the 25 MiB asset cap');
}

ok(manifest.entries.every(e => e.title && e.title.length <= 64),
   'titles present and short enough for a 34-column row');

console.log(failed ? `\n${failed} FAILED — fix archive.json before deploying` : '\nALL PASS');
process.exit(failed ? 1 : 0);
