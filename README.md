# work-mockups

The `/work/` pages of [hubertjablon.ski](https://hubertjablon.ski/): systems I built and run at work,
shown as mock-ups and descriptions written for this site. Their code isn't public, so nothing here is
the real code and there is no screenshot of the real thing.

| Path | What |
|---|---|
| `/work/vllm/` | Multi-GPU LLM deployment manager: a full-page, clickable mock-up that runs in the browser on made-up data, with an About drawer and its architecture drawing |
| `/work/bridge/` | Git forge ⇄ AI agent bridge: how it works, with its pipeline drawn |
| `/work/flota/` | Flota: a fleet of AI coding sessions for one project, with its wiring drawn |
| `/work/` | 302 to `/#projects`: the landing page's Projects section is the index of these pages |
| `/work/assets/*` | content-hashed scripts, styles and fonts, cached for a year |
| `/work/favicon.svg`, `/work/build.json` | the favicon; the commit and CI run the image was built from |
| `/healthz` | `ok`, for probes |

Everything else on the origin (`/`, `/cluster/`, `/lab/`, `/api`) belongs to other images; this one
answers 404 there. The Gateway routes `/work/` here.

## Layout

- `src/vllm.html`, `src/bridge.html`, `src/flota.html`: the pages, with `{{…}}` placeholders the build fills.
- `src/vllm/demo/`: the vLLM mock-up. The rules (admission, eviction, the reservation planner, the
  analytics) are pure functions over one state; the views draw from it.
- `src/diagram/work.ts`: the three architecture drawings, as data and markup, in the same visual
  language as the landing page's "The way in" (`src/diagram/markup.ts` holds the shared helpers).
- `src/ascii/`: the site's hidden ASCII mode, an identical copy of hubertjablon.ski's `src/ascii/`.
- `src/styles.css`: a copy of the site's stylesheet (tokens and components) plus the /work/ blocks.
- `scripts/build.mjs`: the bundle; `scripts/serve.mjs`: a static server with the same headers.

## Develop

```sh
npm ci --ignore-scripts
npm run lint && npm test       # typecheck, unit tests (vitest)
npm run build                  # dist/work/...
npm run serve -- --port 4173   # http://127.0.0.1:4173/work/vllm/
npm run test:e2e               # build, then playwright (desktop and phone)
```

`PW_CHROMIUM_PATH` points Playwright at a preinstalled Chromium when the bundled one is missing.

## Rules the code keeps

- The CSP is the site's, character for character (`security-headers.conf`), Trusted Types included:
  no `innerHTML` or inline styles; the DOM is built with `h()`/`svg()` from `src/lib/dom.ts`, and
  dynamic sizes go through `style.setProperty`. `scripts/serve.mjs` sends the same headers, so the
  browser tests run under the policy nginx serves.
- The page never scrolls or jumps by itself; the vLLM app scrolls inside its own regions.
- The drawings keep the landing diagram's rules (words inside their boxes, no line through a box,
  labels clear of each other and of the lines); `test/e2e/work-diagrams.spec.ts` measures them.

## Image

`Dockerfile` builds the bundle (lint, unit tests, build) and serves `dist/` from nginx-unprivileged.

- port 8080, uid 101, read-only root filesystem;
- the only writable path is `/tmp` (one `emptyDir`/tmpfs): pid file and nginx's temp paths;
- health: `GET /healthz` answers `200 ok` without touching the filesystem;
- GET and HEAD only; logs to stdout and stderr.

`.github/workflows/build-image.yml` runs the unit and browser tests and an unpushed image build on every
pull request; on `main` it builds and pushes `ghcr.io/hubertmj/work-mockups/work`, gates it with Trivy
(fixable CRITICAL/HIGH fail), attests an SPDX SBOM and signs it keylessly with cosign. To verify:

```sh
cosign verify ghcr.io/hubertmj/work-mockups/work@sha256:<digest> \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github\.com/HubertMJ/work-mockups/\.github/workflows/build-image\.yml@refs/heads/main$'
```

The cluster side (the namespace, its HTTPRoute for `/work/`, the Argo CD application and the Kyverno
rule that pins this workflow's identity) lives in self-defending-portfolio, as for `/lab/`. A new image
reaches the cluster when its digest is committed there.

## Licence

MIT, see `LICENSE`.
