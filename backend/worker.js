/**
 * Instant Battle Card Generator — Cloudflare Worker backend
 * -----------------------------------------------------------------------
 * Implements the research/compilation logic described in the spec doc
 * ("Instant Battle Card Generator — Specification Document"). Given an
 * account executive's email, their Company URL, a Competitor URL, a Job
 * Title, and an optional Industry, it:
 *
 *  1. Validates the email against the shared "Customer Overview Dashboard
 *     - Approved Emails" Google Doc (same doc/allow-list mechanism used by
 *     the Syndication & Event Finder backend on this account).
 *  2. Best-effort fetches a text snapshot of both the Company URL and the
 *     Competitor URL homepages as grounding context (non-fatal on failure
 *     — Claude's own web search tool can still find and read the sites).
 *  3. Best-effort fetches the Company URL's logo (Clearbit Logo API, with
 *     a favicon/apple-touch-icon fallback parsed from the homepage HTML)
 *     and a brand accent color (the page's `theme-color` meta tag, with a
 *     neutral default fallback) — both done server-side so the frontend
 *     never has to make a cross-origin fetch of a third-party site (which
 *     the browser would block via CORS).
 *  4. Calls Claude (with the web_search tool) once, with a system prompt
 *     that encodes every rule from the spec's "Collecting And Processing
 *     Data" section, and asks for a single JSON object shaped to exactly
 *     match the 9 battle-card boxes the frontend renders.
 *
 * Required secrets/vars (see README.md for `wrangler secret put` commands):
 *   ANTHROPIC_API_KEY          - required. Your Anthropic API key.
 *   ALLOWED_EMAILS_DOC_ID      - optional but recommended. Google Doc ID of
 *                                the live "approved emails" allow-list doc
 *                                (already defaulted below to the same doc
 *                                referenced in the spec / used by the
 *                                Syndication & Event Finder backend). The
 *                                doc must be shared "Anyone with the link:
 *                                Viewer" so the Worker can read it without
 *                                auth.
 *   ALLOWED_EMAILS_CACHE_TTL_SECONDS
 *                              - optional. Defaults to 300 (5 minutes).
 *   ALLOWED_EMAILS             - optional fallback manual list (secret).
 *   ANTHROPIC_MODEL            - optional. Defaults to DEFAULT_MODEL_ID.
 *   ALLOWED_ORIGIN             - optional. Defaults to "*". Set to your
 *                                GitHub Pages origin once deployed.
 *
 * NOTE ON MODEL / TOOL NAMES: Anthropic occasionally revises the web search
 * tool's type string and model ids. If deploys start failing with a 400
 * referencing "tools" or an unknown model, check
 * https://docs.claude.com/en/docs/about-claude/models and the tool-use /
 * web search docs, then update DEFAULT_MODEL_ID / WEB_SEARCH_TOOL_TYPE below
 * (or just set the ANTHROPIC_MODEL var without redeploying code).
 */

const DEFAULT_MODEL_ID = "claude-sonnet-4-5-20250929";
const WEB_SEARCH_TOOL_TYPE = "web_search_20250305";
const DEFAULT_ALLOWED_EMAILS_DOC_ID = "10rgVyj4uQg8rC4IJNe7Qp4k1QC43YmIBlL9oczWjtLk";
const DEFAULT_ALLOWED_EMAILS_CACHE_TTL_SECONDS = 300;
const DEFAULT_BRAND_COLOR = "#2F6FEB";

// ---------------------------------------------------------------------
// CORS / response helpers
// ---------------------------------------------------------------------

function corsHeaders(env) {
  const origin = (env.ALLOWED_ORIGIN || "*").trim();
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

function errorResponse(message, status, env) {
  return jsonResponse({ status: "error", message }, status, env);
}

// ---------------------------------------------------------------------
// Validation (mirrors app.js so a direct API call is still guarded)
// ---------------------------------------------------------------------

function validate({ email, companyUrl, competitorUrl, jobTitle }) {
  const missing = {
    email: !email,
    companyUrl: !companyUrl,
    competitorUrl: !competitorUrl,
    jobTitle: !jobTitle,
  };
  const missingCount = Object.values(missing).filter(Boolean).length;
  if (missingCount === 0) return null;
  if (missingCount >= 2) return "Please Provide Required Information";
  if (missing.email) return "No Email Provided";
  if (missing.companyUrl) return "Company URL Is Required";
  if (missing.competitorUrl) return "Competitor URL Is Required";
  if (missing.jobTitle) return "Job Title Is Required";
  return "Please Provide Required Information";
}

function isValidEmailFormat(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (err) {
    return url;
  }
}

// ---------------------------------------------------------------------
// Approved-email allow-list (same live-doc pattern as the Syndication &
// Event Finder backend on this account — see that project's worker.js).
// ---------------------------------------------------------------------

function parseEmailListText(raw) {
  return new Set(
    (raw || "")
      .split(/[,\n]/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

function parseAllowedEmailsFromSecret(env) {
  return parseEmailListText(env.ALLOWED_EMAILS);
}

async function fetchAllowedEmailsFromDoc(env) {
  const docId = (env.ALLOWED_EMAILS_DOC_ID || DEFAULT_ALLOWED_EMAILS_DOC_ID).trim();
  if (!docId) return null;

  const ttl = Number(env.ALLOWED_EMAILS_CACHE_TTL_SECONDS) || DEFAULT_ALLOWED_EMAILS_CACHE_TTL_SECONDS;
  const url = `https://docs.google.com/document/d/${docId}/export?format=txt`;

  const res = await fetch(url, {
    redirect: "follow",
    cf: { cacheTtl: ttl, cacheEverything: true },
  });

  if (!res.ok) {
    throw new Error(`Allow-list doc export fetch failed with status ${res.status}`);
  }
  return parseEmailListText(await res.text());
}

async function resolveAllowedEmails(env) {
  try {
    const fromDoc = await fetchAllowedEmailsFromDoc(env);
    if (fromDoc !== null) return fromDoc;
  } catch (err) {
    // Doc unreachable/unshared — fall back rather than failing every request.
  }
  return parseAllowedEmailsFromSecret(env);
}

// ---------------------------------------------------------------------
// Company/competitor homepage snapshot + logo + brand color
// ---------------------------------------------------------------------

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchRawHtml(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; BattleCardGeneratorBot/1.0; +https://github.com/)",
    },
    cf: { cacheTtl: 0 },
  });
  if (!res.ok) return "";
  return await res.text();
}

// Best-effort text snapshot used as grounding context for the model.
// Non-fatal on failure — the model can still use web search.
async function fetchSiteSnapshot(url) {
  try {
    const html = await fetchRawHtml(url);
    if (!html) return "";
    return stripHtml(html).slice(0, 6000);
  } catch (err) {
    return "";
  }
}

// Reads a <meta name="theme-color" content="#xxxxxx"> tag if present.
function extractThemeColor(html) {
  if (!html) return null;
  const match = html.match(/<meta[^>]+name=["']theme-color["'][^>]*>/i);
  if (!match) return null;
  const contentMatch = match[0].match(/content=["']([^"']+)["']/i);
  if (!contentMatch) return null;
  const value = contentMatch[1].trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : null;
}

// Parses <link rel="icon"|"apple-touch-icon" href="..."> as a logo fallback.
function extractIconHref(html, baseUrl) {
  if (!html) return null;
  const linkTags = html.match(/<link[^>]+rel=["'][^"']*(?:icon|apple-touch-icon)[^"']*["'][^>]*>/gi) || [];
  // Prefer apple-touch-icon (usually a proper square logo) over a bare favicon.
  const sorted = linkTags.sort((a, b) => {
    const aTouch = /apple-touch-icon/i.test(a) ? 0 : 1;
    const bTouch = /apple-touch-icon/i.test(b) ? 0 : 1;
    return aTouch - bTouch;
  });
  for (const tag of sorted) {
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    try {
      return new URL(hrefMatch[1], baseUrl).toString();
    } catch (err) {
      continue;
    }
  }
  return null;
}

async function fetchImageAsDataUri(imageUrl) {
  try {
    const res = await fetch(imageUrl, { cf: { cacheTtl: 3600 } });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/png";
    if (!/^image\//i.test(contentType)) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 100) return null; // too small to be a real logo
    const base64 = arrayBufferToBase64(buf);
    return `data:${contentType};base64,${base64}`;
  } catch (err) {
    return null;
  }
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  // btoa is available in the Workers runtime.
  return btoa(binary);
}

// Best-effort brand kit: logo as a data URI (or null — the PDF simply omits
// the logo per the spec, "If no logo can be found ... don't place the
// logo") and a single accent hex color for the PDF header/box borders.
async function fetchBrandKit(url, html) {
  const domain = hostnameOf(url);

  let logoDataUri = await fetchImageAsDataUri(
    `https://logo.clearbit.com/${domain}?size=256&format=png&greyscale=false`
  );
  if (!logoDataUri) {
    const iconHref = extractIconHref(html, url);
    if (iconHref) logoDataUri = await fetchImageAsDataUri(iconHref);
  }

  const brandColor = extractThemeColor(html) || null;

  return { logoDataUri, brandColor };
}

// ---------------------------------------------------------------------
// Job-title breadth note, echoed into the prompt verbatim per spec:
// same-level variants are fine (Data Engineer / Sr. Data Engineer), but a
// step up or down the management ladder is not, except that once the
// submitted title is itself a leadership role, broadening to the next
// leadership level up is fine (Director -> VP, but not Director -> IC).
// ---------------------------------------------------------------------

const JOB_TITLE_BREADTH_RULE = `Job title matching rule: when researching job descriptions for the submitted Job Title, don't limit yourself to that exact string. Include natural seniority variants at the SAME level (e.g. submitted "Data Engineer" also covers "Sr. Data Engineer" or "Lead Data Engineer") — but do not cross from an individual-contributor title into a specific people-manager/leadership title, or vice versa (e.g. submitted "Data Engineer" does NOT cover "Director of Data Engineering"). If the submitted title is itself a leadership role, broadening to the next leadership level up is fine (e.g. submitted "Director of Data Engineering" also covers "VP of Data Engineering") but not down into an individual-contributor role (e.g. not "Data Engineer" or "Sr. Data Engineer").`;

// ---------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------

function buildPrompt({
  companyUrl,
  companyName,
  companySnapshot,
  competitorUrl,
  competitorSnapshotText,
  jobTitle,
  industry,
  today,
}) {
  const industryLine = industry
    ? `Target industry: ${industry}. Restrict job-description research to postings for the target Job Title at companies in this industry. Also prioritize any industry-specific pages/content from either company's website and marketing materials over general messaging when filling out boxes like "Competitor Considerations" or "Where We Win" — general messaging is still useful, but industry-specific proof points should be leaned on more heavily where they exist.`
    : `Target industry: (none specified). Do not restrict research by industry, but still apply every other rule below.`;

  const system = `You are the research engine behind the "Instant Battle Card Generator," a tool that lets an account executive instantly generate a sales battle card for selling against a specific competitor, for a specific job title (and optionally industry) they're about to talk to.

You are given:
- Company URL: the account executive's OWN company (the one selling the product) — never confuse this with the prospect's employer or the competitor.
- Competitor URL: the primary competitor being sold against.
- Job Title: the title of the prospect the account executive is about to speak with.
- Industry (optional): the prospect's industry.

${JOB_TITLE_BREADTH_RULE}

${industryLine}

Use web search plus the homepage snapshots provided below to research both companies' products, positioning, features, customers, and pricing. When a company's own site names specific competitors or comparison pages, prioritize those pages for competitive claims.

Return ONLY a single JSON object (no prose before or after, no markdown code fences) with EXACTLY this shape:

{
  "companyName": "...",
  "competitorName": "...",
  "boxes": {
    "competitorProduct": {
      "competitorName": "...",
      "valueProposition": "...",
      "primaryProducts": "..."
    },
    "ourFeatures": [ { "name": "...", "description": "..." } ],
    "theirFeatures": [ { "name": "...", "description": "..." } ],
    "topInitiatives": [ "..." ],
    "whereWeWin": [ { "feature": "...", "explanation": "...", "relatedInitiativeIndex": 0 } ],
    "competitorChallenges": [ { "feature": "...", "explanation": "...", "whereWeCompete": false, "relatedInitiativeIndex": 0 } ],
    "customerReferences": [ { "name": "...", "inIndustry": false, "referenceUrl": "...", "referenceType": "case_study" } ],
    "talkingPoints": [ { "question": "...", "answer": "..." } ],
    "pricing": { "summary": "...", "isPlaceholder": false }
  }
}

Length rule that applies to EVERY prose field below (NOT names, NOT booleans, NOT the "talkingPoints" questions, which are fixed strings you're told to use verbatim), counting spaces and punctuation: "valueProposition", "primaryProducts", each "description", every "answer", and "pricing.summary" must be 300 characters or fewer; each string in "topInitiatives" and every "explanation" (in both "whereWeWin" and "competitorChallenges") must be 280 characters or fewer — those three are shown as more tightly-spaced list items on the page and in the PDF, so they get the tighter limit. This is the exact same copy shown on the webpage and in the exported PDF, so write each field as an already-tight, complete thought from the start — don't write a longer draft assuming it will get trimmed later. If a point can't be fully made within its limit, keep the single strongest, most concrete part (a specific number, name, or outcome) and drop the rest rather than writing a vaguer full-length version. Do not pad a field with filler just to approach the limit — shorter is fine as long as the point survives.

Rules for each field:

- "competitorName" (top-level) and "boxes.competitorProduct.competitorName": the official name of the company behind Competitor URL (not the URL/domain itself).
- "companyName" (top-level): the official name of the company behind Company URL (not the URL/domain itself).

- "boxes.competitorProduct": "valueProposition" is the competitor's primary value proposition (typically one to two sentences), grounded in their site/marketing materials. "primaryProducts" lists the competitor's main product NAMES relevant to the Job Title (and Industry if given) — if the competitor doesn't name their product(s), use a single short description of what the product does instead of a name.

- "boxes.ourFeatures": exactly up to 5 items — the most relevant and valuable features/capabilities, to the Job Title's likely job description, offered by the COMPANY (Company URL, not Competitor URL). Base this on their website, documentation, marketing materials, social posts, and case studies (bonus weight to case studies tied to the Job Title). Each item's "description" (typically 1-2 sentences) covers the benefit/how it helps, at a general level — it does not need to be tied specifically to the Job Title here (job-title relevance is what "whereWeWin" is for).

- "boxes.theirFeatures": the same exercise as "ourFeatures", but for the COMPETITOR (Competitor URL, not Company URL). Up to 5 items.

- "boxes.topInitiatives": up to 10 bullet points (typically 1-2 sentences each) inferring the business initiatives/priorities of someone with the given Job Title (and Industry, if given), based on patterns across real job postings for that title/level (per the job title matching rule above) and industry. Only include initiatives that relate to what the COMPANY (Company URL) actually sells — ignore initiatives the Job Title handles that are unrelated to this company's product category, even if those initiatives are important to the role in general. ORDER MATTERS: list these from most to least significant/frequent — the frontend displays them as a lettered list (A, B, C, ...) in this exact order, and "whereWeWin"/"competitorChallenges" items below reference them by that position, so put the most important initiative first.

- "boxes.whereWeWin": up to 5 items. Take the COMPANY's (Company URL) products/features/proof points that are superior to or lead the COMPETITOR's (Competitor URL) equivalent, then match them to the highest-ranking items in "topInitiatives" they help with. "feature" is the feature/capability name; "explanation" cites any concrete proof points (performance numbers, savings, adoption numbers, etc.) explaining why the company's product is the ideal solution for that initiative — use the space efficiently, but never drop a concrete proof point just to shorten it further. "relatedInitiativeIndex" is the 0-based index into the "topInitiatives" array (so 0 = the first/"A" initiative, 1 = the second/"B" initiative, etc.) of the single initiative this feature is MOST relevant to — this is used to tag the feature with that initiative's letter, so pick exactly one, the best match.

- "boxes.competitorChallenges": the mirror of "whereWeWin" — up to 5 items highlighting the COMPETITOR's (Competitor URL) features/capabilities that address the top initiatives, where the COMPANY (Company URL) is comparably weaker or has thinner proof points. Same "feature"/"explanation"/"relatedInitiativeIndex" shape. Set "whereWeCompete": true on any item here whose underlying initiative is ALSO addressed by an item in "whereWeWin" (i.e. both companies compete on that same initiative) — false otherwise. (This box is labeled "Competitor Considerations" on the webpage and in the PDF — keep using the "competitorChallenges" key here.)

- "boxes.customerReferences": up to 5 customers named on the COMPANY's (Company URL) website/marketing materials/social posts. Order: any customers in the specified Industry first (set "inIndustry": true on those), then the rest ordered by company size (employee count/revenue) where knowable, otherwise alphabetically. If no Industry was specified, "inIndustry" should be false for all. For each customer, also try to find exactly ONE URL that serves as proof this is a real customer: prefer a dedicated case study, customer story, or testimonial page about them if the COMPANY has one (set "referenceType": "case_study"); otherwise use any other page that names them as a customer — a press release, a logos/quotes page, a review — and set "referenceType": "mention". Use the single most specific, most authoritative URL you can find (never a search-results page). If you can't find a genuine URL for a customer, set both "referenceUrl" and "referenceType" to null — never fabricate or guess a URL.

- "boxes.talkingPoints": Q&A entries, written from the perspective of a salesperson at the COMPANY (Company URL), using messaging/proof points/numbers from both companies' sites where possible. ALWAYS include exactly these three: (1) question: "This product is too expensive" (2) question: "How are you any better than [the competitor's actual name, not the literal word 'competitor']?" (3) question: "We already have a similar solution, why would we replace it with you?". Each "answer" should specifically counter the competitor's top features/marketing claims found in "theirFeatures" and "competitorChallenges", and should align with the prospect Job Title's priorities from "topInitiatives" — write the tightest phrasing that still lands the point and keeps any concrete proof point intact; never sacrifice a concrete number or proof point just to shorten it further. You may include up to 2 additional strong Q&A pairs beyond these three if genuinely useful, for a maximum of 5 total.

- "boxes.pricing": "summary" summarizes any pricing explicitly published on the COMPANY's (Company URL) website, focused on the products/features relevant to the Job Title if pricing is broken out by product. If the website only directs visitors to contact sales (no public pricing), set "summary" to exactly "Refer to internal documentation for pricing." and "isPlaceholder": true. Otherwise "isPlaceholder": false.

All object/array fields must always be present (use an empty array/short placeholder string rather than omitting a key). Do not pad any list with weak/irrelevant items just to fill a quota — fewer strong items beats more weak ones, but always try to reach the stated counts where good candidates genuinely exist.`;

  const user = `Company URL (the account executive's own company — the seller): ${companyUrl}
Homepage snapshot (may be incomplete — use web search for more):
"""
${companySnapshot || "(could not fetch homepage automatically — please look this company up yourself)"}
"""

Competitor URL (the competitor being sold against): ${competitorUrl}
Homepage snapshot (may be incomplete — use web search for more):
"""
${competitorSnapshotText || "(could not fetch homepage automatically — please look this company up yourself)"}
"""

Job Title of the prospect: ${jobTitle}
${industryLine}

Today's date: ${today}

Research and return the JSON object described in your instructions now.`;

  return { system, user };
}

// Statuses worth retrying: 524/529/503/502/500 are all "the request never
// really got a considered answer" (524 in particular is Cloudflare's own
// timeout page in front of Anthropic's API, meaning the request was still
// running past ~100s — this endpoint does up to 14 web searches, which can
// genuinely take a while). 429 (rate limit) is also worth a short
// backoff-and-retry rather than failing the user's request outright.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 524, 529]);
const RETRY_DELAYS_MS = [2000, 5000]; // before attempt 2, then before attempt 3

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callClaude(env, system, userText, attempt = 1) {
  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL_ID;
  const maxAttempts = RETRY_DELAYS_MS.length + 1;

  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        system,
        tools: [{ type: WEB_SEARCH_TOOL_TYPE, name: "web_search", max_uses: 14 }],
        messages: [{ role: "user", content: userText }],
      }),
    });
  } catch (networkErr) {
    // fetch() itself threw — a connection-level failure (DNS, TLS, etc.)
    // rather than an HTTP error response. Also worth a retry.
    if (attempt < maxAttempts) {
      console.warn(`callClaude network error on attempt ${attempt}/${maxAttempts}, retrying:`, networkErr && networkErr.message);
      await sleep(RETRY_DELAYS_MS[attempt - 1]);
      return callClaude(env, system, userText, attempt + 1);
    }
    throw new Error(`Anthropic API request failed after ${maxAttempts} attempts: ${networkErr && networkErr.message}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (RETRYABLE_STATUSES.has(res.status) && attempt < maxAttempts) {
      console.warn(`callClaude got ${res.status} on attempt ${attempt}/${maxAttempts}, retrying:`, detail.slice(0, 200));
      await sleep(RETRY_DELAYS_MS[attempt - 1]);
      return callClaude(env, system, userText, attempt + 1);
    }
    throw new Error(`Anthropic API error ${res.status} after ${attempt} attempt(s): ${detail.slice(0, 500)}`);
  }

  const data = await res.json();
  const textBlocks = (data.content || []).filter((b) => b.type === "text").map((b) => b.text);
  return textBlocks.join("\n").trim();
}

function extractJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate);
  } catch (err) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch (err2) {
      return null;
    }
  }
}

// ---------------------------------------------------------------------
// Sanitization — defensive coercion so a slightly malformed model
// response never crashes the frontend renderer.
// ---------------------------------------------------------------------

function str(v, fallback = "") {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function boolVal(v) {
  return v === true;
}

// ---------------------------------------------------------------------
// 300-character copy cap — the SAME cap for every surface (the webpage
// and the PDF both show this exact field now; there's no separate
// condensed variant anymore) — EXCEPT Top Prospect Initiatives and the
// "explanation" fields in Where We Win / Competitor Considerations, which
// use the tighter TIGHT_COPY_LIMIT (280) since those render as more
// tightly-spaced list items. The model is asked (see buildPrompt) to
// write within whichever limit applies from the start; capToLimit is the
// safety net for whatever slips through over budget anyway. It trims to
// the last full sentence under the limit, falling back to the last full
// word, so nothing gets cut off mid-word.
// ---------------------------------------------------------------------

const COPY_LIMIT = 300;
const TIGHT_COPY_LIMIT = 280;

function capToLimit(text, limit) {
  const max = limit || COPY_LIMIT;
  const t = (text || "").trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const lastSentenceEnd = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (lastSentenceEnd > max / 2) return slice.slice(0, lastSentenceEnd + 1).trim();
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace > max / 2 ? slice.slice(0, lastSpace) : slice.slice(0, max - 1);
  return `${base.trim()}…`;
}

// Validates a model-provided URL, returning it normalized or null. Used
// for customer-reference proof links — never trust the model's string
// as-is, and never let a malformed value reach the frontend as an href.
function urlOrNull(v) {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch (err) {
    return null;
  }
}

// A=0, B=1, ... matches the frontend's upper-alpha lettered list for
// topInitiatives, so a "relatedInitiativeIndex" from the model can be
// turned into the same letter shown on that list.
function indexToLetter(index) {
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 25) return null;
  return String.fromCharCode(65 + index);
}

function sanitizeBoxes(raw, competitorNameFallback) {
  const boxes = (raw && raw.boxes) || {};

  const competitorProductRaw = boxes.competitorProduct || {};
  const competitorProduct = {
    competitorName: str(competitorProductRaw.competitorName, competitorNameFallback),
    valueProposition: capToLimit(str(competitorProductRaw.valueProposition)),
    primaryProducts: capToLimit(str(competitorProductRaw.primaryProducts)),
  };

  const featureList = (list) =>
    (Array.isArray(list) ? list : [])
      .filter((i) => i && str(i.name))
      .slice(0, 5)
      .map((i) => ({ name: str(i.name), description: capToLimit(str(i.description)) }));

  const ourFeatures = featureList(boxes.ourFeatures);
  const theirFeatures = featureList(boxes.theirFeatures);

  const topInitiatives = (Array.isArray(boxes.topInitiatives) ? boxes.topInitiatives : [])
    .map((i) => (typeof i === "string" ? i.trim() : str(i && i.text)))
    .filter(Boolean)
    .slice(0, 10)
    .map((t) => capToLimit(t, TIGHT_COPY_LIMIT));

  // Valid range for relatedInitiativeIndex depends on the (already
  // sanitized) topInitiatives length, so this must run after that array
  // is built above.
  const initiativeLetterFor = (i) => {
    const idx = i && i.relatedInitiativeIndex;
    if (typeof idx !== "number" || idx < 0 || idx >= topInitiatives.length) return null;
    return indexToLetter(idx);
  };

  const winList = (list) =>
    (Array.isArray(list) ? list : [])
      .filter((i) => i && str(i.feature))
      .slice(0, 5)
      .map((i) => ({
        feature: str(i.feature),
        explanation: capToLimit(str(i.explanation), TIGHT_COPY_LIMIT),
        initiativeLetter: initiativeLetterFor(i),
      }));

  const whereWeWin = winList(boxes.whereWeWin);
  const competitorChallenges = (Array.isArray(boxes.competitorChallenges) ? boxes.competitorChallenges : [])
    .filter((i) => i && str(i.feature))
    .slice(0, 5)
    .map((i) => ({
      feature: str(i.feature),
      explanation: capToLimit(str(i.explanation), TIGHT_COPY_LIMIT),
      whereWeCompete: boolVal(i.whereWeCompete),
      initiativeLetter: initiativeLetterFor(i),
    }));

  const customerReferences = (Array.isArray(boxes.customerReferences) ? boxes.customerReferences : [])
    .filter((i) => i && str(i.name))
    .slice(0, 5)
    .map((i) => {
      const referenceUrl = urlOrNull(i.referenceUrl);
      const referenceType = !referenceUrl
        ? null
        : i.referenceType === "case_study" || i.referenceType === "mention"
        ? i.referenceType
        : "mention";
      return { name: str(i.name), inIndustry: boolVal(i.inIndustry), referenceUrl, referenceType };
    });

  const talkingPoints = (Array.isArray(boxes.talkingPoints) ? boxes.talkingPoints : [])
    .filter((i) => i && str(i.question) && str(i.answer))
    .slice(0, 5)
    .map((i) => ({ question: str(i.question), answer: capToLimit(str(i.answer)) }));

  const pricingRaw = boxes.pricing || {};
  const pricing = {
    summary: capToLimit(str(pricingRaw.summary, "Refer to internal documentation for pricing.")),
    isPlaceholder: pricingRaw.isPlaceholder === true || !str(pricingRaw.summary),
  };

  return {
    competitorProduct,
    ourFeatures,
    theirFeatures,
    topInitiatives,
    whereWeWin,
    competitorChallenges,
    customerReferences,
    talkingPoints,
    pricing,
  };
}

// ---------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    if (request.method !== "POST") {
      return errorResponse("Method not allowed.", 405, env);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return errorResponse("Backend is misconfigured (missing ANTHROPIC_API_KEY).", 500, env);
    }

    let body;
    try {
      body = await request.json();
    } catch (err) {
      return errorResponse("Invalid request body.", 400, env);
    }

    const email = (body.email || "").trim();
    const companyUrlRaw = (body.companyUrl || "").trim();
    const competitorUrlRaw = (body.competitorUrl || "").trim();
    const jobTitle = (body.jobTitle || "").trim();
    const industry = (body.industry || "").trim();
    const today = (body.today || new Date().toISOString().slice(0, 10)).trim();

    const validationError = validate({ email, companyUrl: companyUrlRaw, competitorUrl: competitorUrlRaw, jobTitle });
    if (validationError) {
      return errorResponse(validationError, 400, env);
    }
    if (!isValidEmailFormat(email)) {
      return errorResponse("Please enter a valid email address.", 400, env);
    }

    const allowedEmails = await resolveAllowedEmails(env);
    if (allowedEmails.size > 0 && !allowedEmails.has(email.toLowerCase())) {
      return errorResponse("Email was not recognized. Contact administrator for access.", 403, env);
    }

    const companyUrl = normalizeUrl(companyUrlRaw);
    const competitorUrl = normalizeUrl(competitorUrlRaw);

    // Fetch both homepages once each: reused for the text snapshot AND the
    // brand-kit (logo/color) extraction, so we don't fetch twice.
    const [companyHtml, competitorHtml] = await Promise.all([
      fetchRawHtml(companyUrl).catch(() => ""),
      fetchRawHtml(competitorUrl).catch(() => ""),
    ]);
    const companySnapshot = companyHtml ? stripHtml(companyHtml).slice(0, 6000) : "";
    const competitorSnapshotText = competitorHtml ? stripHtml(competitorHtml).slice(0, 6000) : "";

    const brandKitPromise = fetchBrandKit(companyUrl, companyHtml);

    const { system, user } = buildPrompt({
      companyUrl,
      companySnapshot,
      competitorUrl,
      competitorSnapshotText,
      jobTitle,
      industry,
      today,
    });

    let modelText;
    try {
      modelText = await callClaude(env, system, user);
    } catch (err) {
      // The frontend only ever sees the generic message below — this log
      // line is what makes the real cause (status code + Anthropic's error
      // body, or a network-level failure) visible via `wrangler tail`.
      console.error("callClaude failed:", err && err.message ? err.message : err);
      return errorResponse("Could not reach the research service right now. Please try again in a moment.", 502, env);
    }

    const parsed = extractJsonObject(modelText);
    if (!parsed) {
      return errorResponse("Could not parse research results. Please try again.", 502, env);
    }

    const companyName = str(parsed.companyName, hostnameOf(companyUrl));
    const competitorName = str(parsed.competitorName, hostnameOf(competitorUrl));
    const boxes = sanitizeBoxes(parsed, competitorName);

    const brandKit = await brandKitPromise.catch(() => ({ logoDataUri: null, brandColor: null }));

    return jsonResponse(
      {
        status: "ok",
        companyName,
        competitorName,
        jobTitle,
        industry: industry || null,
        generatedAt: new Date().toISOString(),
        logoDataUri: brandKit.logoDataUri || null,
        brandColor: brandKit.brandColor || DEFAULT_BRAND_COLOR,
        boxes,
      },
      200,
      env
    );
  },
};
