# Instant Battle Card Generator

Static frontend (deploy as a GitHub Pages site) + a Cloudflare Worker backend
(`backend/`) that holds the Anthropic API key and does the actual research.
Same split as the Syndication & Event Finder project on this account.

## Deploy

1. **Backend first** — follow `backend/README.md` to deploy the Worker
   (`npx wrangler deploy` after setting the `ANTHROPIC_API_KEY` secret).
2. Copy the deployed Worker URL into `config.js` (`BATTLE_CARD_API_URL`).
3. **Frontend** — create the GitHub repo, push these files (everything
   except `backend/`, or include it too — it's harmless as static files
   since the secrets live in Cloudflare, not in this folder), and enable
   GitHub Pages for the repo (Settings → Pages → deploy from the branch
   root).
4. Confirm the "Customer Overview Dashboard - Approved Emails" Google Doc
   (already wired up via `ALLOWED_EMAILS_DOC_ID` in `backend/wrangler.toml`)
   is still shared "Anyone with the link: Viewer" — the Worker reads it
   live on each request.

## Files

- `index.html`, `style.css`, `app.js`, `config.js`, `robots.txt` — the
  GitHub Pages frontend.
- `backend/` — the Cloudflare Worker. See `backend/README.md` for full
  setup/deploy instructions and notes on a few judgment calls made where
  the spec doc didn't fully pin something down (logo/brand-color
  extraction method, and a small wording inconsistency in the Pricing box
  placeholder text).
