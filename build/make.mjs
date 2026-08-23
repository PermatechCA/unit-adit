/* Assemble the shipped single file from its two sources.
   No bundler, no npm install. Run: node build/make.mjs                       */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');

/* three ships as an ES module ending in one `export{a as Mesh,…}` statement.
   Sealing the whole bundle inside a function and returning that map instead
   gives us a THREE namespace with no top-level names of its own — so none of
   its mangled identifiers can collide with the app's. */
export function inlineThree(){
  const src = read('public/vendor/three.module.min.js').trimEnd();
  const at = src.lastIndexOf('export{');
  if (at < 0) throw new Error('vendored three has no export statement');
  const body = src.slice(0, at);
  const list = src.slice(at + 7, src.lastIndexOf('}'));
  const map = list.split(',').map(part => {
    const [local, name] = part.trim().includes(' as ')
      ? part.trim().split(' as ') : [part.trim(), part.trim()];
    return `${name.trim()}:${local.trim()}`;
  });
  return `const THREE = (function(){\n${body}\nreturn {${map.join(',')}};\n})();\n`;
}

/* Pull the module source back out of a built index.html — used by the boot
   harness so it tests the file that actually ships, not the sources. */
export function moduleOf(html){
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no module script in index.html');
  return m[1];
}

export function build(){
  const shell = read('build/shell.html');
  const app = read('build/app.js');

  const index = shell.replace('@@APP@@', app);
  writeFileSync(join(ROOT, 'public/index.html'), index);

  /* The preview is the same file with three inlined and the import map gone,
     so it opens straight from disk or a sandbox with nothing beside it. */
  const preview = shell
    .replace('<script type="importmap">\n{"imports":{"three":"./vendor/three.module.min.js"}}\n</script>\n', '')
    .replace('<title>UNIT·ADIT — Wasteland Props Archive</title>', '<title>UNIT·ADIT — preview</title>')
    .replace("el.hint.textContent = 'archive.json not found';",
             "el.hint.textContent = 'Preview — drop or open files';")
    .replace('@@APP@@', inlineThree() + app.replace("import * as THREE from 'three';", '/* three inlined above */'));
  writeFileSync(join(ROOT, 'build/adit-preview.html'), preview);

  return {index: index.length, preview: preview.length};
}

if (process.argv[1] && process.argv[1].endsWith('make.mjs')){
  const r = build();
  console.log(`public/index.html        ${(r.index/1024).toFixed(1)} kB`);
  console.log(`build/adit-preview.html  ${(r.preview/1024).toFixed(1)} kB`);
}
