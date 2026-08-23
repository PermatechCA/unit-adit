/* archive.json is the only file a non-engineer edits, and a broken one looks
   exactly like a broken deploy: an empty core log and no error anywhere. This
   validates it against archive.schema.json before it can ship.

   node test/manifest.js                                                      */

import { readFileSync } from 'node:fs';
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

/* enough of draft-07 for this schema: type, required, pattern, additionalProperties */
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

if (manifest.base){
  ok(/^https:\/\//.test(manifest.base) && manifest.base.endsWith('/'),
     `base is an https host ending in a slash — "${manifest.base}"`);
  ok(!manifest.base.includes('adit.wastelandprops.com'),
     'base points at the cache host, not at the app origin');
}

ok(manifest.entries.every(e => e.title && e.title.length <= 64),
   'titles present and short enough for a 34-column row');

console.log(failed ? `\n${failed} FAILED — fix archive.json before deploying` : '\nALL PASS');
process.exit(failed ? 1 : 0);
