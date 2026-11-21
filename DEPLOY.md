# Wasteland Deploy Runbook — new site to live subdomain

Reusable for every site. This copy is filled in for **UNIT·ADIT** at
`adit.wastelandprops.com`. Change the two names in **§0** and the rest is identical.

Pipeline: **VS Code → Gitea (source of truth) → GitHub (mirror) → Cloudflare → subdomain**

All git is done through the VS Code **Source Control** panel (`Ctrl+Shift+G`). No terminal.

---

## 0. Fill these in once

| Slot | This example | Yours |
|---|---|---|
| Project / repo name | `unit-adit` | |
| Subdomain | `adit.wastelandprops.com` | |
| Local folder | `~/work/unit-adit` | |

Rule: repo name = subdomain label. Keeps everything findable later.

---

## 1. Folder layout (before any git)

```
unit-adit/
├── public/
│   ├── index.html            ← the site. the whole instrument, single file
│   ├── vendor/
│   │   └── three.module.min.js   ← three r169, vendored. no CDN, no npm install
│   ├── archive.json          ← the manifest you edit to add cores
│   ├── archive.schema.json   ← autocomplete + validation for the above
│   ├── favicon.svg
│   ├── _headers              ← noindex + cache + permissions (see §1a)
│   └── robots.txt
├── build/
│   ├── shell.html            ← markup + CSS, with an @@APP@@ slot
│   ├── app.js                ← the module, unbundled
│   └── make.mjs              ← assembles the two into public/index.html
├── test/
│   ├── boot.js               ← full init path, stubbed GL + Web Audio + DOM
│   ├── decode.js             ← WAV / FLAC containers → core log
│   └── manifest.js           ← archive.json against its schema
├── README.md
├── DEPLOY.md
└── CLAUDE.md                 ← handoff brief for Claude Code sessions
```

Everything served lives in `public/`. Nothing else gets deployed — `build/` and `test/`
stay in the repo but never ship, which is exactly what pointing the build output at
`public` achieves.

> ⚠️ **`public/index.html` is generated.** Edit `build/shell.html` or `build/app.js`, then
> run `node build/make.mjs` before committing. Editing the built file directly means the
> next build silently reverts it. `make.mjs` has no dependencies and no install step.

> ⚠️ **`public/vendor/` must be committed.** three is vendored deliberately — a CDN import
> is one more origin that can fail, be blocked, or change under you. `_headers` marks it
> immutable so it costs one download ever.

**While building** — `public/robots.txt`:
```
User-agent: *
Disallow: /
```

### 1a. `public/_headers` — three things this site specifically needs

```
/*
  X-Robots-Tag: noindex, nofollow
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Permissions-Policy: clipboard-write=(self), autoplay=(self)

/index.html
  Cache-Control: no-cache, must-revalidate
/
  Cache-Control: no-cache, must-revalidate
/archive.json
  Cache-Control: no-cache, must-revalidate

/vendor/*
  Cache-Control: public, max-age=31536000, immutable
```

> ⚠️ **Cache-Control is not optional here.** The whole instrument is one `index.html`. A
> cached copy is a stale build that looks identical to a current one, and there is no
> version string on screen to tell them apart. This has already cost a debugging cycle once.
> `archive.json` is on the same rule for a different reason: you will add a core, reload,
> see the old log, and go looking for a bug in the fetch.

> ⚠️ **Permissions-Policy** — `navigator.clipboard.writeText` is gated by permissions
> policy. Without `clipboard-write=(self)` the copy-link key (and `K`) silently fails on a
> live origin even though it works locally. `autoplay=(self)` keeps the deep-link path from
> being blocked outright; it still will not sound before a gesture, and that is correct.

> ⚠️ **`_headers` cannot fix the cores.** The audio does not come from this origin. See
> §5a — without CORS on the R2 bucket every core in the log reads `ERR` and nothing here
> changes that.

---

## 1b. Run the harnesses before you commit

```
node build/make.mjs     # rebuild public/index.html from source first
node test/boot.js       # 11 stages: parse → evaluate → ready → log → keys → decode → 4 frames
node test/decode.js     # 15 checks: 32F / 24 / 16 / RF64 / EXTENSIBLE / FLAC / core log
node test/manifest.js   # archive.json against the schema, plus ids, paths, base
```

All three must print PASS. `boot.js` exists because a syntax check cannot see a deleted
function, an orphaned `AudioParam`, a handler assigned to a stale id, or a uniform three
reaches for that was never merged in — every fault that has reached a live build so far was
one of those. It evaluates the real `public/index.html`, so a stale build fails it. See
`CLAUDE.md`.

> ⚠️ `boot.js` relaunches itself with `--experimental-vm-modules`. That is expected; run it
> plainly.

---

## 2. Gitea — create the repo

1. Gitea → **+ → New Repository**.
2. Owner: your org/user. Name: `unit-adit`. Visibility: **Private**.
3. **Do not** initialise with README — VS Code pushes one.
4. Copy the HTTPS clone URL.

---

## 3. VS Code — publish the folder (GUI only)

1. **File → Open Folder** → your project folder.
2. **Source Control** panel → **Initialize Repository**.
3. Type a commit message → **✓ Commit**. If it asks to stage all changes, say **Yes**.
4. **… menu → Remote → Add Remote** → paste the Gitea URL → name it `origin`.
5. **Publish Branch** (or **… → Push**). Sign in to Gitea when prompted.

Confirm the files appear in Gitea.

> ⚠️ If VS Code's git settings were edited before and something is broken, check
> `settings.json` — a git block nested inside another JSON block silently breaks git in
> VS Code. It must sit at the top level.

---

## 4. GitHub — the mirror

Cloudflare cannot see self-hosted Gitea. GitHub is a required bridge, not a duplicate.

### 4.1 Empty repo
GitHub (org `wasteland-props`) → **New repository** → name `unit-adit` → **Private** →
**no** README/licence/gitignore → Create.

### 4.2 Token
GitHub → **Settings → Developer settings → Personal access tokens → Tokens (fine grained) →
No expiration → Only selected repositories → select unit-adit → Add permission: contents →
read and write.

> ⚠️ *"Password authentication is not supported for Git operations"* always means the same
> thing: you used your password where the **token** is required.

### 4.3 Push mirror
Gitea repo → **Settings → Repository → Mirror Settings → Add Push Mirror**:

- **URL:** `https://github.com/wasteland-props/unit-adit.git`
- **Username:** GitHub username
- **Password:** the **token**
- ✅ **Sync when commits are pushed**
- **Add** → **Synchronize Now**

> ⚠️ Gitea's **Settings** tab sits at the far right of the tab row and is easy to miss.

Confirm the commits appear on GitHub.

---

## 5. Cloudflare — deploy

Dashboard → **Workers & Pages → Create application → Connect to Git** → authorise GitHub →
select `unit-adit`.

- **Production branch:** `main`
- **Build command:** *(empty — static site)*
- **Deploy command:** `npx wrangler deploy` (the default)
- **Non-production branch deploy command:** `npx wrangler versions upload` (the default)
- **Root directory:** *(empty)*

Deploy. Live in under a minute.

> ⚠️ **`wrangler.jsonc` at the repo root is what tells Cloudflare to upload `public/`.** Keep it.
> Without it, a push to any branch other than `main` fails with *"Missing entry-point to Worker
> script or to assets directory"*, and a `main` build may open an auto-config pull request
> instead of deploying. It has no `routes` on purpose: the custom domain stays managed in the
> dashboard. A branch push gives you a preview URL under **Deployments**: test there, then merge
> to `main`.

> ⚠️ You get a **Worker with static assets**, not a "Pages project" — Cloudflare merged
> Pages into Workers. A `*.workers.dev` URL instead of `*.pages.dev` is correct and fine.
> `_headers` and `_redirects` still work.

> ⚠️ **The assets directory is the number one cause of blank deploys.** If the site
> deploys but shows 404 or nothing, check `"directory": "./public"` in `wrangler.jsonc` first.

> ⚠️ With a build step (React/Vite/Astro), set the build command (`npm run build`) and point
> the output at `dist` / `build` / `.output/public`. Plain HTML: leave the command empty.
> **ADIT is plain HTML** — `make.mjs` runs on your machine, not on Cloudflare. Leave it empty.

---

## 5a. Where the audio lives, and letting this origin read it

ADIT ships no audio. You put files somewhere reachable over HTTPS and list them in
`public/archive.json` — `file` is what streams, `master` is what the download button pulls.

**Under 25 MiB per file, skip this whole section.** Cloudflare caps an individual static
asset at 25 MiB; below that you can put the audio in `public/audio/`, set
`"base": "audio/"` in the manifest, and serve it from this same origin. No bucket, no CORS,
nothing here to get wrong.

**Above it, use R2 — and this unit will not work without the rest of this section.** Stereo
24-bit/96 kHz runs about 35 MB per minute as WAV and 46 MB as 32-bit float, so anything past
a short clip is an R2 object. The archive lives in the `wasteland-caches` bucket, served from
`caches.wastelandprops.com`, and a cross-origin `fetch()` needs the bucket's permission.

> ⚠️ Upload with **rclone**, not wrangler. `wrangler r2 object put` is single-part only and,
> without `--remote`, silently writes to the local simulator while reporting success.

Dashboard → **R2 → wasteland-caches → Settings → CORS Policy → Edit**:

```json
[
  {
    "AllowedOrigins": [
      "https://adit.wastelandprops.com",
      "https://workbench.wastelandprops.com",
      "https://unit-adit.<your-subdomain>.workers.dev"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["range", "content-type"],
    "ExposeHeaders": ["content-length", "content-range", "accept-ranges"],
    "MaxAgeSeconds": 86400
  }
]
```

Include the `workers.dev` origin as well — §6a happens there, before the domain exists.

> ⚠️ **Public Workbench is a second origin for the same cores.** At
> `workbench.wastelandprops.com/adit/` the archive is fetched with Workbench as the origin, so it needs
> its own line above. Without it the library lists your own work fine and every ARCHIVE core reads `ERR`.
> A Workbench preview on its own `workers.dev` URL needs its line too.

> ⚠️ **A CORS failure looks identical to a wrong path.** Every core in the log shows `ERR`,
> the stamp reads a fetch error, and nothing appears in the Cloudflare logs because the
> browser refused before the request mattered. If §6a's core-log row goes red, come back
> here first.

> ⚠️ Downloads go through the same wall, and they pull a *different object*. The control
> fetches `master` to a blob rather than using a plain `<a download>`, because a cross-origin
> host ignores the `download` attribute. So **no CORS means no downloads even though the core
> plays**, and a missing `master` object fails on a core that streamed perfectly.

---

## 6. Subdomain — `adit.wastelandprops.com`

The apex domain is already on Cloudflare, so this is DNS-free.

1. Project → **Settings → Domains & Routes → Add → Custom domain**.
2. Enter `adit.wastelandprops.com`.
3. Cloudflare creates the CNAME and provisions HTTPS automatically. Live in a few minutes.

**For every future site, only this string changes** — `sim.`, `pegg.`, `tinkertaylor.`, etc.
Same apex, same procedure, no DNS editing.

> ⚠️ Attaching the domain is what makes it public. Do it at launch, not before.

> ⚠️ Once the domain is attached, add it to the R2 CORS list in §5a if you only listed the
> `workers.dev` origin.

---

## 6a. Smoke test on the live origin

Run this on the `workers.dev` URL before attaching the domain. Every item here behaves
differently over HTTPS than it does locally, so none of it can be checked beforehand.

| Check | Expected | If it fails |
|---|---|---|
| Boot log clears, core log fills | 4 rows, no red | the log prints the stage and message — read it |
| Click a core | strata build, transport reads **READING** | check the boot panel, not the console |
| Status strip | `WAV 32F / 2ch`, rate, `NATIVE` | `RESAMPLED` is fine — the browser refused that rate |
| Any core shows `ERR` | — | R2 CORS — §5a, before anything else |
| **TRUE PEAK** on a hot float file | reads above `+0.0 dBFS` in red | float clamped on decode; the parser was bypassed |
| dBFS meters | move while playing | analysers lost their sink — see `CLAUDE.md` |
| Row **↓** | the **master** saves under its own name | R2 CORS, or the master object is missing — §5a |
| No **Open files** button, dragging a file does nothing | correct — that is `?log` only | — |
| Reload with `?log` appended | drop and **Open files** come back | — |
| Copy-link key, then paste in a new tab | loads that core at that moment, does not autoplay | `clipboard-write=(self)` missing — §1a |
| Press and hold the ruler, drag | amber A/B region, loop confines to it | — |
| Loop key three times | play once → loop → chain | — |
| iPhone: tabs, 52 px rows, nothing under the notch | usable one-handed | check `env(safe-area-inset-*)` survived |
| iPhone: drag the core log | the list scrolls, the page does not move | the `touchmove` guard — `CLAUDE.md` § Touch |
| iPhone: whole core visible between tabs and deck | ends not under the chrome | `frameRead()` — `CLAUDE.md` § Framing |
| Hard-refresh twice | same build both times | `Cache-Control` missing — §1a |

> ⚠️ **This is the main reason to deploy.** On `file://` and in sandboxed previews the
> browser sanitises every runtime error to a bare `"Script error."` with no message, line or
> stack. On a real origin the fault reporter can finally show what actually broke.

> ⚠️ `file://` fails earlier than that here: ES modules and `fetch` are both blocked on an
> opaque origin, so the import map never resolves. The boot panel says so. Locally, serve it
> — `python3 -m http.server 8080` from `public/`.

---

## 6b. Inside Public Workbench (`workbench.wastelandprops.com/adit/`)

Workbench's own build ships ADIT there; this repo's job is to hand it a passing build. Once Workbench
is deployed, check these on its origin. The contract is Workbench's `WORKBENCH.md`.

| Check | Expected | If it fails |
|---|---|---|
| Strip reads `LIBRARY  N YOURS · M ARCHIVE` | FIELD takes, PS-1 loops and shelf items first, newest first, then the archive tagged ARCHIVE | `window.__workbench` not set: Workbench's corner-mark script must run before ADIT's module |
| Archive cores in the library | they read, no `ERR` | R2 CORS is missing the Workbench origin — §5a |
| A FIELD take still recording | not listed | — |
| **Open files**, then reload | the file is still listed, tagged OPENED | the browser can't write files (Safari before 26): the hint says so and keeps it for the session only |
| **Send to** row | hidden until some tool declares it takes audio; then one button per such tool | Workbench's `wb/build.json` |
| Send a core with A/B marked | the tool opens with just that region, as 32-bit float | — |
| Copy-link key | works | Workbench's headers need `clipboard-write=(self)` as in §1a: ADIT's `_headers` does not apply on Workbench's site |
| iPhone 390 px | nothing past the right edge, Open files on screen, IDLE/READING visible in the strip | the phone block in `build/shell.html` |

---

## 7. Stay private until launch

Three levels; only the third is real privacy.

1. **Obscurity** — stay on the `workers.dev` URL. Weak.
2. **noindex** — `robots.txt` + `X-Robots-Tag: noindex`. Keeps it out of search; anyone with
   the link still gets in.
3. **Cloudflare Access** — a real login wall. **Zero Trust → Access → Applications → Add a
   self-hosted application** → cover the hostname → policy **Allow → your email**.

> ⚠️ Zero Trust requires a payment method on file even on the free tier.

At launch: remove the Access app, delete `robots.txt` and the noindex header, attach the
domain.

> ⚠️ Leave the `Cache-Control` and `Permissions-Policy` lines in `_headers` at launch. Only
> the `X-Robots-Tag` block comes out.

> ⚠️ Cloudflare Access sits in front of the app, not in front of R2. A private ADIT still
> serves its cores from a public bucket. If the recordings themselves are not for sharing
> yet, keep them out of `archive.json` rather than relying on the login wall.
