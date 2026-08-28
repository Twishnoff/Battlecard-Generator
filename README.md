# Instant Battle Card Generator — backend

A Cloudflare Worker that powers the frontend in the parent folder. It takes
`{ email, companyUrl, competitorUrl, jobTitle, industry, today }`, uses
Claude (with the web search tool) to research both companies and compile the
nine battle-card sections defined in the spec doc, and returns everything
the frontend needs to render the boxes and build the PDF — including a
best-effort company logo and brand accent color, fetched server-side so the
browser never has to make a cross-origin request of a third-party site.

This mirrors the same pattern as the Syndication & Event Finder backend —
a single-file Worker calling the Anthropic API — deployed on the same
Cloudflare account.

## 1. Install wrangler (once)

```bash
npm install
```

(or `npm install -g wrangler` if you'd rather not keep a local `node_modules`)

## 2. Log in to Cloudflare (once)

```bash
npx wrangler login
```

## 3. Set secrets

```bash
npx wrangler secret put ANTHROPIC_API_KEY
# paste your Anthropic API key when prompted
```

That's the only secret required for a fresh deploy. The approved-email
allow-list syncs live from the same Google Doc the spec references — see
"Email allow-list source" below — so `wrangler secret put ALLOWED_EMAILS` is
only needed if you want a manual fallback list.

## 4. (Optional) non-secret settings

Edit `wrangler.toml`'s `[vars]` section, or set them ad hoc:

- `ALLOWED_EMAILS_DOC_ID` — already set to the doc referenced in the spec
  (and reused from the Syndication & Event Finder project). Change it only
  if you want this tool to check a different allow-list.
- `ALLOWED_EMAILS_CACHE_TTL_SECONDS` — how long (seconds) the Worker
  edge-caches the doc fetch before re-reading it. Defaults to `300` (5
  minutes).
- `ANTHROPIC_MODEL` — override the default model id in `worker.js`
  (`DEFAULT_MODEL_ID`) without redeploying code.
- `ALLOWED_ORIGIN` — restrict CORS to your GitHub Pages origin, e.g.
  `https://twishnoff.github.io`. Defaults to `*` (any origin) if unset.

## 5. Deploy

```bash
npx wrangler deploy
```

This publishes to `https://battle-card-generator.<your-subdomain>.workers.dev`.
Copy that URL into `config.js` in the parent folder (`BATTLE_CARD_API_URL`).

## 6. Test it

```bash
curl -X POST https://battle-card-generator.<your-subdomain>.workers.dev \
  -H "Content-Type: application/json" \
  -d '{
    "email": "you@example.com",
    "companyUrl": "https://example.com",
    "competitorUrl": "https://competitor-example.com",
    "jobTitle": "Data Engineer",
    "industry": "Oil and Gas",
    "today": "2026-08-27"
  }'
```

You should get back `{"status":"ok","companyName":"...","competitorName":"...","logoDataUri":"...","brandColor":"#......","boxes":{...}}`.

## Notes / things to double-check

- **Model & tool names drift.** If you get a 400 error mentioning `model` or
  `tools`, check the current docs and update `DEFAULT_MODEL_ID` /
  `WEB_SEARCH_TOOL_TYPE` at the top of `worker.js` (or set `ANTHROPIC_MODEL`
  as a var to avoid a code change).
- **Cost/latency.** Each request lets Claude make up to 14 web searches
  before answering, so a single run typically takes 30-90 seconds. Lower
  `max_uses` in `worker.js` for faster/cheaper responses at the cost of
  thinner research, or raise the Worker's CPU time limit on a paid
  Cloudflare plan if you see timeouts.
- **Logo/brand color extraction is best-effort, not the spec's literal
  words.** The spec says the PDF should use "brand colors of the provided
  Company URL based on the colors and design of the website," but a
  browser can't read a third-party site's CSS/colors from client-side code
  (CORS), and there's no reliable universal API for "extract a site's brand
  palette." This Worker instead: (1) tries the site's own
  `<meta name="theme-color">` tag for a single accent color, falling back to
  a neutral blue if absent; (2) tries the Clearbit Logo API
  (`logo.clearbit.com`) for the company logo, falling back to the site's own
  `<link rel="apple-touch-icon">`/favicon if Clearbit has nothing, and
  omitting the logo entirely (per the spec) if neither is found. If you want
  truer brand-color extraction later (e.g. sampling the page's actual CSS/
  screenshot), that's a larger follow-up — flag it if it matters for now.
- **Company snapshot fetch.** The worker does a best-effort raw GET of both
  homepages to give Claude a head start; if a site blocks bots or requires
  JS to render, the snapshot may come back empty and Claude relies on web
  search of the domain instead — not fatal.
- **Email allow-list source.** Read live from the Google Doc referenced in
  `ALLOWED_EMAILS_DOC_ID` — no manual copy/paste or redeploy needed when the
  list changes. Requires the doc's sharing to stay "Anyone with the link:
  Viewer." If sharing is ever changed to "Restricted," the Worker falls back
  to the `ALLOWED_EMAILS` secret (empty by default — meaning the allow-list
  check is skipped and anyone gets in), so check the doc's sharing first if
  access suddenly seems wrong for everyone. One email per line or
  comma-separated, case-insensitive, blank lines ignored. A doc edit takes
  effect within `ALLOWED_EMAILS_CACHE_TTL_SECONDS` (default 5 minutes).
- **Pricing box wording.** The spec's "Page Design" section says the
  placeholder should read "See Internal Pricing Documentation," but the
  more detailed "Collecting And Processing Data" section later says
  "Refer to internal documentation for pricing." This worker uses the
  latter (more specific) wording — change the string in `sanitizeBoxes()`
  if you'd rather standardize on the former.
