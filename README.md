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
A tool that keeps more than one kind of sound can say which in its shelf sidecar:
`"category": "field" | "samples" | "strip" | "kit" | "waves"`. Without it, the folder decides
(`shelf/sluice/` STRIP, `shelf/fathom/` KIT, `shelf/lathe/` WAVES, any other tool SAMPLES).

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

- lists a **FATHOM kit** as one entry (its name and how many sounds) that opens to show its sounds in
  pad order. Open, it offers **Send kit to** (only tools whose build.json `takes` includes `"kit"`; a
  kit of more than 16 sends the first 16 and says so on the button) and **Delete kit**;
- tells the receiving tool what it is sending: `kind: "sound"`, `"waves"` for a LATHE table (sent byte
  for byte, whole, so its `clm ` frame-size chunk survives), or a v2 `"kit"` note;
- **renames and deletes** anything in the library from the deck (Rename · Delete, two taps to delete):
  a FIELD take, a PS-1 loop, a stem, a kit, a file you opened. A rename rewrites only the title in the
  owner's own sidecar; a delete takes the sidecar first, then the audio. Archive cores can't be changed.
- is **every tool's "Your library"** on Open: Workbench opens `/adit/?pick=<tool>` in a sheet, a compact
  list with **Use** and **Cancel** (Esc). Use hands the sound back to the tool as stored (a wavetable byte
  for byte), or just the A/B region, as 32-bit float, if one is marked on the sound you're previewing.

The full contract is in Workbench's `WORKBENCH.md`.
At `adit.wastelandprops.com` none of this happens: ADIT is the archive, as before.

## Multichannel and ambisonic files

A file with more than two channels gets a **Listen as** row in the deck. Every channel has a key, so you
can solo or drop any of them; what you leave on is summed to both ears. A four-channel file can also be
heard as first-order **AmbiX** (ACN/SN3D, the default when the name says ambix, FOA, B-format, H3-VR or
NT-SF1) or **FuMa**: it is decoded to eight virtual speakers through the browser's HRTF, so on headphones
each sound keeps its place.

B-format opens in the **SPACE** view: a wire ball you stand in, the recording's front marked in amber
on the equator. Every moment of the take puts three motes on it (low in rust, mid in amber, high in
bone) where that band's energy came from, so the whole recording hangs there as a faint constellation;
the moment under the read head flares and trails a comet of the last few seconds. The teal glyph is the
**receiver**, you. Drag it toward a sound and the field leans that way (Gerzon's dominance, up to
+12 dB toward, as much down behind) and you turn to face it; drag around it to orbit; double-click to
go back to the centre.

What you hear is what goes on: **Send to** and **Keep what you hear** render the receiver's position
as a 32-bit float stereo WAV (the A/B region only, if one is marked). The ↓ download is always the
recorded B-format, untouched.

## Cutting a section

The **Cut** key (scissors, or C) marks a section of the loaded sound between two handles, A and B, on
the ruler. Drag them, or play and tap **A here** / **B here**. The cut row shows the section's length,
channels and size, and makes:

- **New sound**: the section as a sound of its own, beside the original (in Workbench it's kept in
  your library; on the archive site it opens in the log for now). Cut as many as you like.
- **Download WAV**: the section as a file.
- **Trim to A/B**: for sounds of your own, the section replaces the original (two taps). The cut is
  kept first; only then is the original removed.

Every route cuts the recorded samples, every channel, 32-bit float, nothing clamped: a B-format take
stays four-channel B-format, and if you chose AmbiX or FuMa by hand the cut's name says so, so it opens
the same way. Archive cores cut from their float master. On the archive site with `?log`, the readout
warns when a section is over the 25 MiB limit for an archive core. **LEVEL** in the deck is listening
level only: it changes nothing that is kept, sent or downloaded.

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
| C (or the scissors key) | Cut: A/B handles on the ruler, and New sound · Download WAV · Trim |
| I / O / X | mark A, mark B, clear |
| V (or the view key) | READ → DIVE → RACK, with SPACE first for B-format |
| SPACE: drag the receiver | move where you listen from; drag around it to orbit, double-click to recentre |
| drag the core | seek by depth |
| drag beside the core | turn it |
| DIVE: drag up / down | travel through the core; sideways turns it |
| RACK: tap a core | load it |
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
