# UNIT·ADIT

Archive access for the Wasteland Props cache library. Every recording is logged
as a core sample: you read the strata, then hear the seam.

- 32-bit float WAV read exactly as recorded — peaks above 0 dBFS are preserved
  and shown, not clamped
- Also reads RF64, WAVE_FORMAT_EXTENSIBLE, PCM 8/16/24/32, float64, and FLAC
- Playback runs at each file's native sample rate; the strip says so when it can't
- Browse by search or seam, listen, and download any core — the download goes
  through a blob fetch so it survives a cross-origin R2 host
- Two files per core: FLAC streams, the 32-bit float WAV is what downloads

## Build and run

`public/index.html` is generated. Edit `build/shell.html` (markup + CSS) or
`build/app.js` (the module), then:

```
node build/make.mjs     # assemble public/index.html
node test/boot.js       # 11 stages against the built file
node test/decode.js     # containers and core logging
node test/manifest.js   # archive.json against its schema
cd public && python3 -m http.server 8080
```

No dependencies, no install step. `make.mjs` also writes
`build/adit-preview.html` — the same app with three inlined, which opens
standalone with nothing beside it.

Then open `http://localhost:8080`. It will not run from `file://` — ES modules
and `fetch` are blocked on opaque origins. The boot log in the bottom-left says
so if you try.

## Add cores

Put the audio somewhere reachable over HTTPS, then list it in
`public/archive.json`. VS Code autocompletes and validates from
`archive.schema.json`; `node test/manifest.js` checks it properly.

```json
{
  "id": "WP-C-0001",
  "title": "Dry dock — mooring chain, wet",
  "file":   "cache-01/mooring-chain-wet.flac",
  "master": "cache-01/mooring-chain-wet-32f.wav",
  "category": "field",
  "tags": ["field", "metal"],
  "loc": "44.6650 -63.5870",
  "date": "2026-03-11",
  "notes": "Half-tide. Chain under load, hull groan underneath at 31 Hz.",
  "license": "CC BY-NC 4.0 — commercial on request"
}
```

`file` is what plays. `master` is what the ↓ button pulls, and is optional — if
it is absent the download is `file`. Publish FLAC to stream and the float WAV as
the master: FLAC is roughly half the weight and every current browser decodes it
natively, but it is integer-only and cannot carry the headroom above 0 dBFS that
this unit exists to preserve.

`base` is joined to every relative path; absolute `https://` URLs are used as-is.
The filter bar is fixed: **ALL · FIELD · SAMPLES · STRIP · KIT · WAVES**. Set `"category"` on a core
(`field`, `samples`, `strip`, `kit`, `waves`); without it a core is `field`. `tags` stay on the row
and are searched, but no longer make buttons. Inside Workbench, your own work sorts itself: FIELD
takes under FIELD, PS-1 loops and files you open under SAMPLES, SLUICE stems under STRIP, FATHOM
kits under KIT, LATHE tables under WAVES. A category with nothing in it shows, dimmed.

### Where to put the audio

Cloudflare caps an individual static asset at 25 MiB, so only short pieces can
live beside the app. Under that, drop them in `public/audio/`, set
`"base": "audio/"`, and the whole R2 and CORS step in `DEPLOY.md` §5a disappears
— same origin, nothing to configure.

Above it, use the `wasteland-caches` R2 bucket. Upload with **rclone**, not
wrangler: `wrangler r2 object put` is single-part only and, without `--remote`,
silently writes to the local simulator while reporting success. Stereo 24-bit/96
kHz is about 35 MB per minute as WAV and 46 MB as 32-bit float, so a five-minute
recording is an R2 object either way.

## Inside Public Workbench: the library

At `workbench.wastelandprops.com/adit/` ADIT is the library for every Workbench tool. Workbench's
corner-mark script sets `window.__workbench`; when it's there, ADIT:

- lists **your own work first**: FIELD's finished takes (with category, place and coordinates), PS-1's
  loops, and anything a tool keeps on the shelf (`shelf/<tool>/`). The Wasteland Props archive follows,
  tagged ARCHIVE;
- **keeps files you open** (Open files, or drop) in `shelf/adit/`, so every tool can reach them;
- offers **Send to** for each tool that takes sound: the core on the head, or its A/B region, always as
  32-bit float WAV. An archive core sends its float master, the same file its download gives.

It reads other tools' files and never changes them. The full contract is in Workbench's `WORKBENCH.md`.
At `adit.wastelandprops.com` none of this happens: ADIT is the archive, as before.

## Reading local files

The archive is a shelf, not a workshop — visitors cannot load their own audio.
Append `?log` to the URL to turn on drag-and-drop, folder drop and the **Open
files** button for auditioning before upload. Nothing is ever sent anywhere;
decoding happens in the browser.

## On a phone

The layout switches to one panel at a time at 700 px: a tab bar for **core log**
/ **read head**, 52 px rows, 48 px transport keys, a two-bar level meter folded
into the status strip, and the search field at 16 px so iOS does not zoom the
viewport on focus. Tapping a core plays it and swings to the read head; one tap
on the tab bar goes back. Folder drop is desktop only — iOS has no directory
picker, so use **Open files** and multi-select from Files.

## Controls

| | |
|---|---|
| Space | play / pause |
| ← → | ±5 s |
| ↑ ↓ | previous / next core |
| L | cycle play once → loop → chain |
| D | download the loaded core |
| / | jump to search |
| K | copy a link to this moment |
| I / O / X | mark A, mark B, clear |
| Alt+Tab | swing between read head and rack |
| drag the core | seek by depth |
| drag the ruler | seek by time |
| press and hold the ruler, then drag | mark an A/B region |

## Links

Every core has a hash link: `#c=WP-C-0001&t=83.20&a=80.00&b=88.50` — core, moment,
and marked region. `K` or the chain key copies one for whatever is on the head
right now. Hash only, so Cloudflare needs no rewrite rule. Arriving on a link
loads and seeks but does not autoplay, because a cold page load is not a user
gesture and Safari will refuse.

## Deploy

Cloudflare Pages/Workers, build output `public/`, empty build command. Repo name
is the subdomain label: `unit-adit` → `adit.wastelandprops.com`.

Set CORS on the `wasteland-caches` R2 bucket to allow the archive's origin,
otherwise every remote core fails to fetch.

## Files

```
public/index.html                 the whole instrument, generated
public/vendor/three.module.min.js three r169, vendored — commit it
public/archive.json               the manifest you edit
public/archive.schema.json        autocomplete + validation
public/_headers                   cache, noindex, clipboard permission
build/shell.html · app.js         the sources
build/make.mjs                    assembles them
test/boot.js · decode.js · manifest.js
DEPLOY.md                         Gitea → GitHub → Cloudflare → subdomain
CLAUDE.md                         hard constraints and verification greps
```

Deploying is `DEPLOY.md`. The one thing that is not in this repo: the
`wasteland-caches` R2 bucket needs a CORS policy naming this origin, or every
core reads `ERR` and nothing downloads. See `DEPLOY.md` §5a.
