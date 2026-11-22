# UNIT·ADIT — hard constraints

An **adit** is the horizontal tunnel that gets you into the workings. This is the
archive's way in. Axis: **through**. (QUARRY down · LATHE around · LOOM across ·
FATHOM depth · ADIT through.)

## Doctrine

1. **Nothing is synthesised.** Every band of colour on a core is measured from the
   recording: RMS sets diameter, spectral centroid sets mineral, transient jumps
   set bedding planes. No `createOscillator`, no procedural placeholder audio,
   ever — including in demo modes.
2. **Render measurement, not matter.** Nothing in the scene is lit. No
   `SpotLight`, no `MeshStandardMaterial`, no shadow map, no radially displaced
   solid. LATHE shipped exactly that once and it looked like a low-poly tree
   trunk — solid surface reads as matter, brown noise over it reads as wood, and
   a fundamental-dominated displacement grows one fat lobe per revolution.
   Everything here is an emissive trace, additively blended into a void, bloomed
   by the five-pass composite. If a future change adds a light, the diagnosis
   has been forgotten.
3. **The surface is the spectrum.** Each ring is one time slice's magnitude
   spectrum wrapped once around the turn, log spaced from 30 Hz to Nyquist, in
   dB over a 78 dB window normalised to the loudest band **in the whole core**.
   Global, never per slice — a quiet passage has to look quiet. Down is time,
   around is frequency. This is why a tonal recording grows vertical ridges.
4. **Mint is reserved.** `--mint` belongs to the tool ring and the live trace and
   nothing else. Rust / amber / bone carry frequency; a second cold accent
   destroys the read-head hierarchy.
5. **The float is the point.** WAV is parsed in-house, not by `decodeAudioData`,
   because several browsers clamp 32-bit float to ±1.0 on decode and that throws
   away the headroom the archive exists to preserve. Do not "simplify" the parser
   away.
3. **Single deliverable file.** `public/index.html` holds all markup, CSS and JS.
   Only `vendor/three.module.min.js` sits beside it. No bundler, no npm install,
   no framework.
4. **Never delete code without grepping every call site first.**
5. **No raw `ShaderMaterial` may set `fog: true`.** three calls
   `uniforms.fogColor.value.copy(scene.fog.color)` on every frame for any
   material with `fog === true`, and a hand-written `uniforms` object has no
   `fogColor` — so it throws *once per frame, forever*. This cost a whole
   session. Either merge `THREE.UniformsLib.fog` into the uniforms and include
   the fog chunks, or leave `fog` false and fade by hand. Built-in materials
   (`MeshStandardMaterial`, `PointsMaterial`) are unaffected.
6. **The render loop is fault-tolerant on purpose.** Three consecutive throws
   halt it and report once to the boot panel. Do not "clean up" the try/catch —
   without it a single bad frame produces thousands of identical console lines
   and buries the real fault.
7. **The boot harness stays.** `window.__adit.ready` plus the `error` /
   `unhandledrejection` listeners are the only thing that reports a fault on
   `file://`, where the browser sanitises everything to "Script error."

## Inside Public Workbench (`window.__workbench` present)

8. **Other tools' files: read freely, change only on the user's say-so.** FIELD (`recordings/`), PS-1
   (`library/`) and the shelf (`shelf/<tool>/`). ADIT writes `shelf/adit/` (files the user opens) and
   `shelf/_handoff/`; beyond that only **Rename** (rewrites one title field in the owner's sidecar, read
   fresh: FIELD `meta.title`, PS-1 `name`, shelf `title`) and **Delete** (sidecar first, then the audio;
   PS-1's whole `library/<id>/`). Nothing else in another tool's files is ever touched, and a FIELD take
   whose sidecar isn't `done` is never listed (it's locked while recording).
9. **Library paths stay relative** (`../wb/build.json`, `../<tool>/?handoff`). Workbench's build refuses
   root paths.
10. Outside Workbench nothing changes: the archive is a shelf, local files stay behind `?log`.
11. **A hand-off is always 32-bit float WAV built from samples**, never the source bytes passed through.
    An archive core sends its float **master** (the same file its download gives), because the FLAC
    stream is integer and has already lost the headroom. The A/B region, if marked, is cut from those
    samples. Doctrine 5 applies across the hand-off too.
12. **Another tool's sidecar is data, not a promise.** Each one is read inside its own `try`, and
    `Library.scan()` never throws. One half-written or differently shaped file must not stop ADIT
    booting inside Workbench; the reference build once died on a FIELD location with no `lon`.
13. **Library text reaches the page as text.** File names, FIELD notes and other tools' tags go through
    `esc()` before any `innerHTML`. That origin holds every Workbench tool's files.
14. **The monitor is a way of listening, never a transform.** Mix, AmbiX and FuMa change what reaches
    the ears only. Download, hand-off and the core are always the recorded channels. Web Audio's own
    down-mix drops channels past stereo, so a file of more than two channels always goes through the
    monitor's splitter, never straight to the trim.

## Harnesses — run before every commit

```
node build/make.mjs     # public/index.html is generated; rebuild first
node test/boot.js       # evaluates the built file against stubbed GL/Audio/DOM
node test/decode.js
node test/manifest.js
```

`boot.js` catches the fault class a syntax check cannot: a deleted function, an
orphaned `AudioParam`, a handler bound to a stale id, a uniform three reaches for
that was never merged in. It reads `public/index.html`, so a stale build fails.

## Verification greps — run before every commit

Counts are for `public/index.html`.

| grep | expected |
|---|---|
| `createOscillator` | **0** — doctrine 1 |
| `localStorage` | **2** — the Workbench hand-off note: one `setItem`, one comment. Library mode only; blocked in the artifact sandbox, where library mode never runs |
| `parseWav` | **3** — definition, the call in `decode()`, and the hand-off reading a float master (rule 11) |
| `workbench-accepts` | **0** — Workbench's build would read it as ADIT accepting sound, comments included |
| `decodeAudioData` | **2** — comment + the FLAC/lossy branch only |
| `logCore(` | **2** — definition and the call in `selectEntry` |
| `copyToChannel` | **1** — the only route from parsed samples into an AudioBuffer |
| `SLICES` | **23** |
| `createPanner` | **2** — the feature check and the one call: the ambisonic monitor's eight virtual speakers. Nothing else is spatialised |
| `ShaderMaterial` | **3** — bright, blur, composite. Nothing else may be one. |
| `SpotLight` | **0** — see doctrine 2 |
| `MeshStandardMaterial` | **0** — see doctrine 2 |
| `download(` | **4** — definition, row click, deck key, keyboard `D` |
| `S.mode` states | **3** — `off`, `one`, `chain`. The loop key cycles them. |

If a count moves, either the change is wrong or this table is stale. Fix one.

## Audience

This is a public shelf, not a workshop. A visitor listens and downloads; they
cannot load their own audio. Drag-and-drop, folder drop and **Open files** are a
maintainer's bench tool gated behind `?log` — do not surface them by default, and
do not let the empty state address the archivist instead of the reader.

Each core is two objects: `file` streams (FLAC, roughly half the weight, decoded
natively everywhere) and `master` downloads (32-bit float WAV). FLAC is
integer-only, so it cannot carry the headroom above 0 dBFS that the in-house WAV
parser exists to preserve — that is the entire reason for the split. `master` is
optional and falls back to `file`.

## Framing

`frameRead()` measures the band the HUD leaves between `#tabs`/`#strip` and
`#deck`, then **scales the specimen** to fill it and shifts `VIEWS.read.a.y` so
its centre lands in the middle of that band. Never fit by dollying the camera
back instead — at the distance needed on a phone the core sits deep in the
`FogExp2` and goes grey. Camera distance is fixed per breakpoint; only `k`
moves. `gridMesh.position.y` and `dustGrp.scale` follow `k` or the datum floats
off the bottom of the specimen.

Re-run it from `resize()`, `orientationchange`, and `visualViewport.resize` —
iOS grows and shrinks its toolbar without ever firing a window resize.

## Touch

`touch-action` on an ancestor clamps every descendant, so the scroll lock must
**never** live on `body` — that is what silently killed core-log scrolling once
already. It lives on the chrome (`#strip`, `#tabs`, `#deck`, `#meter`, `#filter`,
`#idxfoot`, `#stamp`) and `#rows` is left free with `pan-y` + `overscroll-behavior:
contain`.

`body` is `position:fixed; inset:0` so there is nothing at document level for iOS
to pan, and a non-passive `touchmove` listener swallows every single-finger move
outside `#rows`. Two-finger moves pass through untouched — that is pinch-zoom and
removing it is an accessibility regression, not a fix. Preventing the default
also stops Safari claiming the gesture and firing `pointercancel` mid-drag, so
core scrubbing gets more reliable rather than less.

## Layout invariants

- `--u: 4px` is the lattice. Every padding, gap, and size is a multiple. No
  `border-radius` anywhere except the range input's native thumb.
- One cold colour on screen: `--mint`, used only by the scan ring and its light.
  Adding a second cold accent breaks the read-head hierarchy.
- HUD grid areas are `strip / index / meter / deck`. Do not add a fifth panel —
  put new readouts in the strip.

## Audio graph

```
AudioBufferSourceNode → gain (trim) ─┬→ destination
                                     └→ up-mix → ChannelSplitter ─┬→ Analyser L ─┐
                                                                  └→ Analyser R ─┴→ sink (0 gain) → destination
```

The muted sink is **load-bearing**, not tidiness. An AnalyserNode with no
outgoing connection is a terminal node: Chrome keeps an automatic-pull list and
processes it anyway, WebKit does not, so on iOS the meters read a flat −∞
forever. Never delete the sink. The up-mix is equally load-bearing —
`ChannelSplitterNode` is fixed at discrete interpretation by spec, so a mono core
would otherwise only ever light the left meter. Meters read **post-trim**, so they show what leaves the
deck. The over-range zone above 0 dBFS is real, not decoration: float sources
routinely peak above it.

The context is rebuilt at each core's native sample rate (`ensureCtx`). If the
browser refuses the rate it falls back and the strip reads `RESAMPLED`. Do not
pin the context to 48 kHz.

## Deployment

See `DEPLOY.md`. Repo `unit-adit` → `adit.wastelandprops.com`, Cloudflare build
output `public/`, empty build command.

The one non-obvious step is §5a: the `wasteland-caches` R2 bucket must send
`Access-Control-Allow-Origin` for this origin. Without it every core reads `ERR`
and every download is blocked, while the app itself looks perfectly healthy.
