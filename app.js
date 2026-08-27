(function () {
  const form = document.getElementById("battle-card-form");
  const emailInput = document.getElementById("email-input");
  const companyUrlInput = document.getElementById("company-url-input");
  const competitorUrlInput = document.getElementById("competitor-url-input");
  const jobTitleInput = document.getElementById("job-title-input");
  const industryInput = document.getElementById("industry-input");
  const submitBtn = document.getElementById("submit-btn");
  const alertEl = document.getElementById("alert-message");
  const savePdfBtn = document.getElementById("save-pdf-btn");

  const BOX_TITLES = {
    competitorProduct: "Competitor and Product",
    ourFeatures: "Our Key Features",
    theirFeatures: "Their Key Features",
    topInitiatives: "Top Prospect Initiatives",
    whereWeWin: "Where We Win",
    competitorChallenges: "Competitor Considerations",
    customerReferences: "Customer References",
    talkingPoints: "Key Talking Points",
    pricing: "Pricing Overview",
  };

  const boxEls = {};
  Object.keys(BOX_TITLES).forEach((key) => {
    boxEls[key] = document.querySelector(`#box-${key} .box-body`);
  });

  // "Their Key Features" is titled after whichever competitor was actually
  // researched, once that's known — falls back to this generic placeholder
  // (also the default text baked into index.html) before/between runs.
  const THEIR_FEATURES_PLACEHOLDER = "Competitor Key Features";
  const theirFeaturesTitleEl = document.querySelector("#box-theirFeatures h2");

  function setTheirFeaturesTitle(competitorName) {
    theirFeaturesTitleEl.textContent = competitorName ? `${competitorName} Key Features` : THEIR_FEATURES_PLACEHOLDER;
  }

  const REQUIRED_INPUTS = [emailInput, companyUrlInput, competitorUrlInput, jobTitleInput];

  // Holds everything the PDF template needs from the most recent successful
  // run. Cleared whenever a new run starts or fails, so the PDF button can
  // never export stale data.
  let lastRunData = null;

  // --- Required-field gating (button greys out until all required fields
  // are filled, per the spec's User Flow section) -------------------------

  function allRequiredFilled() {
    return REQUIRED_INPUTS.every((el) => el.value.trim().length > 0);
  }

  function refreshSubmitState() {
    submitBtn.disabled = !allRequiredFilled();
  }

  REQUIRED_INPUTS.forEach((el) => el.addEventListener("input", refreshSubmitState));
  refreshSubmitState();

  // --- Alerts --------------------------------------------------------------

  function showAlert(message) {
    alertEl.textContent = message;
    alertEl.hidden = false;
  }

  function clearAlert() {
    alertEl.hidden = true;
    alertEl.textContent = "";
  }

  // --- Box state helpers -----------------------------------------------

  function allBoxElements() {
    return Object.values(boxEls);
  }

  function resetBoxesToLoading() {
    allBoxElements().forEach((el) => {
      el.removeAttribute("data-state");
      el.innerHTML = '<span class="loading"><span class="spinner" aria-hidden="true"></span>Generating…</span>';
    });
    setTheirFeaturesTitle(null);
  }

  function resetBoxesToNoData() {
    allBoxElements().forEach((el) => {
      el.setAttribute("data-state", "empty");
      el.textContent = "No Data Collected";
    });
    setTheirFeaturesTitle(null);
  }

  function disablePdfButton() {
    savePdfBtn.disabled = true;
    savePdfBtn.title = "Run the generator first";
    lastRunData = null;
  }

  function enablePdfButton() {
    savePdfBtn.disabled = false;
    savePdfBtn.title = "";
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function emptyState(el) {
    el.setAttribute("data-state", "empty");
    el.textContent = "No Relevant Results Found";
  }

  // --- Per-box HTML renderers (mirrors the field shapes worker.js sends) --

  function renderCompetitorProduct(el, data) {
    const cp = (data && data.competitorProduct) || {};
    if (!cp.competitorName && !cp.valueProposition && !cp.primaryProducts) {
      emptyState(el);
      return;
    }
    el.removeAttribute("data-state");
    el.innerHTML = `
      <div class="kv-line"><span class="kv-label">Competitor Name:</span> ${escapeHtml(cp.competitorName || "—")}</div>
      <div class="kv-line"><span class="kv-label">Value Proposition:</span> ${escapeHtml(capToLimit(cp.valueProposition) || "—")}</div>
      <div class="kv-line"><span class="kv-label">Primary Products:</span> ${escapeHtml(capToLimit(cp.primaryProducts) || "—")}</div>
    `;
  }

  function renderFeatureTable(el, items) {
    if (!items || items.length === 0) {
      emptyState(el);
      return;
    }
    el.removeAttribute("data-state");
    const rows = items
      .map((i) => `<tr><td><strong>${escapeHtml(i.name)}</strong></td><td>${escapeHtml(capToLimit(i.description))}</td></tr>`)
      .join("");
    el.innerHTML = `<table><tbody>${rows}</tbody></table>`;
  }

  // Letters use the same bold-boxed treatment as the Where We Win /
  // Competitor Considerations badges (.initiative-badge) — here they sit
  // to the left of each initiative as a marker, since this box has no
  // separate "feature name" line for a badge to sit below.
  function renderInitiatives(el, items) {
    if (!items || items.length === 0) {
      emptyState(el);
      return;
    }
    el.removeAttribute("data-state");
    el.innerHTML = items
      .map((t, idx) => {
        const letter = indexToLetter(idx) || String(idx + 1);
        return `<div class="initiative-item"><div class="initiative-badge">${escapeHtml(
          letter
        )}</div><div class="initiative-copy">${escapeHtml(capToLimit(t))}</div></div>`;
      })
      .join("");
  }

  // "initiativeLetter" ties a feature back to the lettered Top Prospect
  // Initiatives list. The feature name, its letter badge, and (for
  // Competitor Considerations) the "Where We Compete" tag are stacked in
  // a centered column (.feature-cell) below the feature name itself, per
  // the layout spec — the letter badge is drawn twice the size used
  // elsewhere (see .feature-cell .initiative-badge in style.css).
  function renderWinLoseTable(el, items, { competeFlag } = {}) {
    if (!items || items.length === 0) {
      emptyState(el);
      return;
    }
    el.removeAttribute("data-state");
    const rows = items
      .map((i) => {
        const compete = competeFlag && i.whereWeCompete ? '<div class="tag-compete">Where We Compete</div>' : "";
        const badge = i.initiativeLetter
          ? `<div class="initiative-badge" title="Ties to Top Prospect Initiative ${escapeHtml(
              i.initiativeLetter
            )}">${escapeHtml(i.initiativeLetter)}</div>`
          : "";
        return `<tr><td><div class="feature-cell"><strong>${escapeHtml(
          i.feature
        )}</strong>${badge}${compete}</div></td><td>${escapeHtml(capToLimit(i.explanation))}</td></tr>`;
      })
      .join("");
    el.innerHTML = `<table><tbody>${rows}</tbody></table>`;
  }

  // Right-hand column links to the one proof point (a case study if one
  // exists, otherwise any page that names them as a customer) that backs
  // up each reference — so "Customer References" isn't just a list of
  // names with nothing behind them.
  function renderCustomerReferences(el, items) {
    if (!items || items.length === 0) {
      emptyState(el);
      return;
    }
    el.removeAttribute("data-state");
    const rows = items
      .map((i) => {
        const tag = i.inIndustry ? '<span class="tag-in-industry">In Industry</span>' : "";
        const link = i.referenceUrl
          ? `<a class="reference-link" href="${escapeHtml(i.referenceUrl)}" target="_blank" rel="noopener noreferrer">${
              i.referenceType === "case_study" ? "Case Study" : "Reference"
            }</a>`
          : '<span class="reference-none">—</span>';
        return `<tr><td>${escapeHtml(i.name)}${tag}</td><td>${link}</td></tr>`;
      })
      .join("");
    el.innerHTML = `<table class="ref-table"><tbody>${rows}</tbody></table>`;
  }

  function renderTalkingPoints(el, items) {
    if (!items || items.length === 0) {
      emptyState(el);
      return;
    }
    el.removeAttribute("data-state");
    el.innerHTML = items
      .map(
        (i) =>
          `<div class="qa-item"><div class="qa-q">Q: ${escapeHtml(i.question)}</div><div class="qa-a">A: ${escapeHtml(
            capToLimit(i.answer)
          )}</div></div>`
      )
      .join("");
  }

  function renderPricing(el, pricing) {
    const p = pricing || {};
    if (!p.summary) {
      emptyState(el);
      return;
    }
    el.removeAttribute("data-state");
    const cls = p.isPlaceholder ? "placeholder-text" : "";
    el.innerHTML = `<div class="${cls}">${escapeHtml(capToLimit(p.summary))}</div>`;
  }

  function renderResults(data) {
    const boxes = data.boxes || {};
    renderCompetitorProduct(boxEls.competitorProduct, boxes);
    renderFeatureTable(boxEls.ourFeatures, boxes.ourFeatures);
    renderFeatureTable(boxEls.theirFeatures, boxes.theirFeatures);
    renderInitiatives(boxEls.topInitiatives, boxes.topInitiatives);
    renderWinLoseTable(boxEls.whereWeWin, boxes.whereWeWin);
    renderWinLoseTable(boxEls.competitorChallenges, boxes.competitorChallenges, { competeFlag: true });
    renderCustomerReferences(boxEls.customerReferences, boxes.customerReferences);
    renderTalkingPoints(boxEls.talkingPoints, boxes.talkingPoints);
    renderPricing(boxEls.pricing, boxes.pricing);
  }

  // --- Form validation (mirrors worker.js) --------------------------------

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

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    clearAlert();

    const email = emailInput.value.trim();
    const companyUrl = companyUrlInput.value.trim();
    const competitorUrl = competitorUrlInput.value.trim();
    const jobTitle = jobTitleInput.value.trim();
    const industry = industryInput.value.trim();

    const validationError = validate({ email, companyUrl, competitorUrl, jobTitle });
    if (validationError) {
      showAlert(validationError);
      return;
    }

    if (
      typeof BATTLE_CARD_API_URL === "undefined" ||
      !BATTLE_CARD_API_URL ||
      BATTLE_CARD_API_URL.indexOf("REPLACE_WITH_YOUR_WORKER_URL") !== -1
    ) {
      showAlert("The backend isn't configured yet (see config.js).");
      return;
    }

    submitBtn.disabled = true;
    disablePdfButton();
    resetBoxesToLoading();

    try {
      const res = await fetch(BATTLE_CARD_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          companyUrl,
          competitorUrl,
          jobTitle,
          industry: industry || null,
          today: new Date().toISOString().slice(0, 10),
        }),
      });

      const payload = await res.json().catch(() => null);

      if (!res.ok || !payload || payload.status === "error") {
        resetBoxesToNoData();
        const message = payload && payload.message ? payload.message : "Something went wrong. Please try again.";
        showAlert(message);
        return;
      }

      renderResults(payload);
      setTheirFeaturesTitle(payload.competitorName || competitorUrl);

      lastRunData = {
        companyUrl,
        competitorUrl,
        companyName: payload.companyName || companyUrl,
        competitorName: payload.competitorName || competitorUrl,
        jobTitle,
        industry: industry || null,
        generatedAt: payload.generatedAt || new Date().toISOString(),
        logoDataUri: payload.logoDataUri || null,
        brandColor: payload.brandColor || "#2F6FEB",
        boxes: payload.boxes || {},
      };
      enablePdfButton();
    } catch (err) {
      resetBoxesToNoData();
      showAlert("Could not reach the backend. Please try again.");
    } finally {
      refreshSubmitState();
    }
  });

  // --- PDF template ---------------------------------------------------
  // Landscape battle card matching the spec's "PDF Design" section: a
  // title bar, an info strip, 2 rows of 4 boxes, and one full-width box
  // for Key Talking Points. Drawn directly with jsPDF (not a table lib)
  // since this is a card grid, not tabular data.
  //
  // Copy-length rule: every prose copy block (an answer, an explanation,
  // a description, ...) is capped at 300 characters — see
  // COPY_LIMIT/capToLimit below — and this is now the SAME copy shown on
  // the page, not a separate PDF-only condensed version, so both surfaces
  // always match. If a box still has more copy than fits on one page even
  // after that cap (e.g. 10 Top Initiatives), the rest spills into a
  // same-named "[Box Title] (Cont.)" box rather than getting clipped —
  // see flowBoxLines below.

  function hexToRgb(hex) {
    const clean = (hex || "#2F6FEB").replace("#", "");
    const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
    const num = parseInt(full, 16);
    if (Number.isNaN(num)) return [47, 111, 235];
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function slugify(str) {
    return (
      String(str)
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "battle-card"
    );
  }

  function indexToLetter(index) {
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 25) return null;
    return String.fromCharCode(65 + index);
  }

  // Shared 300-character copy cap — the SAME limit used on the page
  // (renderResults above) and here in the PDF, since there's no longer a
  // separate condensed PDF-only field. The backend is asked to write
  // within this limit from the start; capToLimit is the client-side
  // safety net for whatever slips through over budget anyway (an older
  // cached run, or a field the model missed) — it trims to the last full
  // sentence under the limit, falling back to the last full word, so
  // copy never gets cut off mid-word.
  const COPY_LIMIT = 300;

  function capToLimit(text) {
    const t = String(text == null ? "" : text).trim();
    if (t.length <= COPY_LIMIT) return t;
    const slice = t.slice(0, COPY_LIMIT);
    const lastSentenceEnd = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
    if (lastSentenceEnd > COPY_LIMIT / 2) return slice.slice(0, lastSentenceEnd + 1).trim();
    const lastSpace = slice.lastIndexOf(" ");
    const base = lastSpace > COPY_LIMIT / 2 ? slice.slice(0, lastSpace) : slice.slice(0, COPY_LIMIT - 1);
    return `${base.trim()}…`;
  }

  // Builds the plain-text body lines for a given box, shared by the PDF
  // renderer. Each line is { bold, text, gapAfter, url }. Mirrors the
  // on-page HTML rendering above — same copy, same 300-character cap
  // (see COPY_LIMIT above). buildPdf below paginates on top of that, and
  // overflows any box that still doesn't fit into a "(Cont.)" box. A line
  // with `url` set is drawn as a clickable link (see drawBox) — used for
  // each customer reference's proof-point link.
  function buildPdfLines(boxKey, boxes) {
    const lines = [];
    const push = (text, bold, gapAfter, url) =>
      lines.push({ text, bold: !!bold, gapAfter: gapAfter || 4, url: url || null });

    if (boxKey === "competitorProduct") {
      const cp = boxes.competitorProduct || {};
      push("Competitor Name:", true, 2);
      push(cp.competitorName || "—", false, 6);
      push("Value Proposition:", true, 2);
      push(capToLimit(cp.valueProposition) || "—", false, 6);
      push("Primary Products:", true, 2);
      push(capToLimit(cp.primaryProducts) || "—", false, 6);
    } else if (boxKey === "ourFeatures" || boxKey === "theirFeatures") {
      const items = boxes[boxKey] || [];
      if (items.length === 0) push("No Relevant Results Found", false, 4);
      items.forEach((i) => {
        push(i.name, true, 2);
        push(capToLimit(i.description), false, 6);
      });
    } else if (boxKey === "topInitiatives") {
      const items = boxes.topInitiatives || [];
      if (items.length === 0) push("No Relevant Results Found", false, 4);
      items.forEach((t, idx) => push(`${indexToLetter(idx) || idx + 1}. ${capToLimit(t)}`, false, 5));
    } else if (boxKey === "whereWeWin" || boxKey === "competitorChallenges") {
      const items = boxes[boxKey] || [];
      if (items.length === 0) push("No Relevant Results Found", false, 4);
      items.forEach((i) => {
        const tag = boxKey === "competitorChallenges" && i.whereWeCompete ? "  [Where We Compete]" : "";
        push(`${i.feature}${tag}`, true, 2);
        if (i.initiativeLetter) push(`Ties to Initiative ${i.initiativeLetter}`, true, 3);
        push(capToLimit(i.explanation), false, 6);
      });
    } else if (boxKey === "customerReferences") {
      const items = boxes.customerReferences || [];
      if (items.length === 0) push("No Relevant Results Found", false, 4);
      items.forEach((i) => {
        const industryTag = i.inIndustry ? "  (In Industry)" : "";
        const refLabel = i.referenceUrl ? (i.referenceType === "case_study" ? "Case Study" : "Reference") : null;
        const text = `• ${i.name}${industryTag}${refLabel ? `  —  ${refLabel}` : ""}`;
        push(text, false, 5, i.referenceUrl);
      });
    } else if (boxKey === "pricing") {
      const p = boxes.pricing || {};
      push(capToLimit(p.summary) || "Refer to internal documentation for pricing.", false, 6);
    } else if (boxKey === "talkingPoints") {
      const items = boxes.talkingPoints || [];
      if (items.length === 0) push("No Relevant Results Found", false, 4);
      items.forEach((i) => {
        push(`Q: ${i.question}`, true, 2);
        push(`A: ${capToLimit(i.answer)}`, false, 8);
      });
    }
    return lines;
  }

  // Extra breathing room between the title's divider line and the body
  // copy below it (previously the copy started right on top of the line).
  const BOX_TITLE_BODY_GAP = 8;

  // Chrome (title + divider + the gap above) reserved at the top of every
  // box, and a small bottom pad — used both to measure how tall a box
  // needs to be and to know where its body text starts when actually
  // drawing it. Keep this in sync with drawBox below: it must equal
  // however far down drawBox's cursorY has moved by the time it starts
  // drawing body lines, or content will get measured/allocated one height
  // and drawn at another.
  const BOX_CHROME_TOP = 35 + BOX_TITLE_BODY_GAP;
  const BOX_BOTTOM_PAD = 10;
  const BOX_PAD_X = 10;

  // Measures how tall a box needs to be to show ALL of `lines` without
  // clipping, at the given content width. Used to size rows/boxes to their
  // content instead of guessing a fixed height (which is what caused the
  // PDF to cut boxes off after a few lines).
  function measureContentHeight(doc, lines, maxWidth) {
    let h = 0;
    for (const line of lines) {
      doc.setFont("helvetica", line.bold ? "bold" : "normal");
      doc.setFontSize(8.5);
      const wrapped = doc.splitTextToSize(line.text, maxWidth);
      h += wrapped.length * 10 + line.gapAfter;
    }
    return h;
  }

  function boxHeightForLines(doc, lines, boxWidth) {
    return BOX_CHROME_TOP + measureContentHeight(doc, lines, boxWidth - BOX_PAD_X * 2) + BOX_BOTTOM_PAD;
  }

  // Given a budget of vertical space, returns as many leading `lines` as
  // fit (`chunk`) and whatever's left over (`remaining`). Shared by the
  // grid rows (splitting a box's content at its row's height) and the
  // full-width flowing box (splitting at whatever's left on the page) —
  // both need the exact same "how much fits" measurement.
  function splitLinesForHeight(doc, lines, maxWidth, availableHeight) {
    let consumedHeight = 0;
    let consumedCount = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      doc.setFont("helvetica", line.bold ? "bold" : "normal");
      doc.setFontSize(8.5);
      const wrapped = doc.splitTextToSize(line.text, maxWidth);
      const lineHeight = wrapped.length * 10 + line.gapAfter;
      if (consumedCount > 0 && consumedHeight + lineHeight > availableHeight) break;
      consumedHeight += lineHeight;
      consumedCount += 1;
    }
    // Always make progress, even if a single line is taller than the
    // available space (drawBox's own clip is the last-resort safety net).
    if (consumedCount === 0 && lines.length > 0) consumedCount = 1;
    return {
      chunk: lines.slice(0, consumedCount),
      remaining: lines.slice(consumedCount),
      consumedHeight,
    };
  }

  // Draws one box (border + title + wrapped body lines) at exactly the
  // height passed in. `h` should already be sized to fit every line via
  // boxHeightForLines/measureContentHeight — the clip-with-ellipsis path
  // below is only a last-resort safety net, not the normal path.
  function drawBox(doc, { x, y, w, h, title, lines, accentRgb }) {
    doc.setDrawColor(226, 226, 230);
    doc.setLineWidth(0.75);
    doc.roundedRect(x, y, w, h, 4, 4);

    doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.rect(x, y, w, 3, "F");

    const pad = BOX_PAD_X;
    let cursorY = y + 3 + pad + 8;
    const maxWidth = w - pad * 2;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(31, 32, 35);
    doc.text(title, x + pad, cursorY);
    cursorY += 14;

    doc.setDrawColor(230, 230, 234);
    doc.line(x + pad, cursorY - 8, x + w - pad, cursorY - 8);
    cursorY += BOX_TITLE_BODY_GAP;

    const bottomLimit = y + h - 8;

    for (const line of lines) {
      if (cursorY > bottomLimit) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(7.5);
        doc.setTextColor(150, 150, 155);
        doc.text("…", x + pad, cursorY);
        break;
      }
      doc.setFont("helvetica", line.bold ? "bold" : "normal");
      doc.setFontSize(8.5);
      if (line.url) {
        // Color a linked line (a customer reference's proof link) in the
        // brand accent so it reads as clickable, even though PDF viewers
        // don't otherwise style textWithLink text differently on their own.
        doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      } else {
        doc.setTextColor(line.bold ? 31 : 70, line.bold ? 32 : 71, line.bold ? 35 : 78);
      }
      const wrapped = doc.splitTextToSize(line.text, maxWidth);
      for (const wl of wrapped) {
        if (cursorY > bottomLimit) break;
        if (line.url) {
          doc.textWithLink(wl, x + pad, cursorY, { url: line.url });
        } else {
          doc.text(wl, x + pad, cursorY);
        }
        cursorY += 10;
      }
      cursorY += line.gapAfter;
    }
  }

  function buildPdf(run) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const MARGIN = 30;
    const GAP = 10;
    const accentRgb = hexToRgb(run.brandColor);

    // "Their Key Features" is titled after the researched competitor, same
    // as on the page (see setTheirFeaturesTitle in app.js) — falls back to
    // the same generic placeholder when no competitor name came back.
    const boxTitles = {
      ...BOX_TITLES,
      theirFeatures: run.competitorName ? `${run.competitorName} Key Features` : "Competitor Key Features",
    };

    let y = MARGIN;

    // A slim running header stamped at the top of every page after the
    // first (the first page gets the full title/info header below).
    function drawContinuationHeader() {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(31, 32, 35);
      doc.text(`Competitive Battle Card: ${run.competitorName} (continued)`, MARGIN, MARGIN + 10);
      doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.setLineWidth(1.2);
      doc.line(MARGIN, MARGIN + 18, pageWidth - MARGIN, MARGIN + 18);
      return MARGIN + 32;
    }

    // Full title bar + logo + info strip — page 1 only.
    if (run.logoDataUri) {
      try {
        doc.addImage(run.logoDataUri, MARGIN, y, 36, 36, undefined, "FAST");
      } catch (err) {
        // Unsupported format or corrupt data URI — silently skip the logo.
      }
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(31, 32, 35);
    doc.text(`Competitive Battle Card: ${run.competitorName}`, pageWidth / 2, y + 24, { align: "center" });
    y += 46;

    doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.setLineWidth(2);
    doc.line(MARGIN, y, pageWidth - MARGIN, y);
    y += 18;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(80, 81, 88);
    const generated = new Date(run.generatedAt || Date.now()).toLocaleString();
    const infoLine = [
      `Generated: ${generated}`,
      `Company: ${run.companyName}`,
      `Target Competitor: ${run.competitorName}`,
      `Target Job Title: ${run.jobTitle}`,
      `Specified Industry: ${run.industry || "Unspecified"}`,
    ].join("    |    ");
    doc.text(doc.splitTextToSize(infoLine, pageWidth - MARGIN * 2), MARGIN, y);
    y += 26;

    // Draws one full-width box that can flow across as many pages as its
    // content needs. Used both for Key Talking Points (which is always
    // laid out this way, since it's the box most likely to run long) and
    // for any grid-row box below whose content didn't fit within its
    // row's height. Each page/box gets as much of the content as fits;
    // anything left over continues in a "[title] (Cont.)" box, so nothing
    // is ever cut from the PDF. Pass `startAsContinuation: true` when the
    // content being flowed is itself the leftover from a box drawn
    // elsewhere (a grid-row box) — that titles every box this call draws,
    // including the first, "(Cont.)" rather than only from the second one
    // onward.
    function flowBoxLines(title, allLines, { startAsContinuation = false } = {}) {
      const w = pageWidth - MARGIN * 2;
      let remaining = allLines.slice();
      let first = !startAsContinuation;

      while (remaining.length > 0) {
        const availableOnPage = pageHeight - MARGIN - y;
        if (availableOnPage < BOX_CHROME_TOP + BOX_BOTTOM_PAD + 40) {
          doc.addPage();
          y = drawContinuationHeader();
          continue;
        }
        const usable = availableOnPage - BOX_CHROME_TOP - BOX_BOTTOM_PAD;
        const { chunk, remaining: rest, consumedHeight } = splitLinesForHeight(
          doc,
          remaining,
          w - BOX_PAD_X * 2,
          usable
        );
        remaining = rest;
        const boxH = BOX_CHROME_TOP + consumedHeight + BOX_BOTTOM_PAD;

        drawBox(doc, {
          x: MARGIN,
          y,
          w,
          h: boxH,
          title: first ? title : `${title} (Cont.)`,
          lines: chunk,
          accentRgb,
        });
        y += boxH + GAP;
        first = false;

        if (remaining.length > 0) {
          doc.addPage();
          y = drawContinuationHeader();
        }
      }
    }

    // Grows a row's height from its content-driven baseline toward the
    // bottom of whichever page it actually landed on (the page-break
    // decision above has already happened by the time this is called), up
    // to however tall the row would need to be to show ALL of its
    // content with zero overflow (`idealHeight`, uncapped). A row is
    // usually capped well short of a full page (maxFreshPageHeight leaves
    // room for a footer etc.), so there's normally real slack below it —
    // this spends that slack on fitting more real content before falling
    // back to spilling anything into a "(Cont.)" box, which is the whole
    // point of the "try to extend the box toward the bottom of the page
    // first" rule.
    function growRowHeightToFitPage(rowY, baselineHeight, idealHeight) {
      if (idealHeight <= baselineHeight) return baselineHeight;
      // Same boundary drawRow/drawSecondRowWithTalkingPoints already used
      // to decide whether this row needed a fresh page (pageHeight -
      // MARGIN), just a couple points of rounding safety short of it —
      // a box drawn up to that line still ends a full MARGIN above the
      // page edge, well clear of the page-number footer near the bottom.
      const availableOnPage = pageHeight - MARGIN - rowY - 2;
      return Math.min(idealHeight, Math.max(baselineHeight, availableOnPage));
    }

    // Draws a row of equal-width boxes, sized to whichever box in the row
    // needs the most room, capped at a full fresh page's height, moving
    // the WHOLE row to a fresh page first if it wouldn't fit on the
    // current one. Once that page is settled, growRowHeightToFitPage
    // above gets first crack at fitting everything by growing the row
    // toward the bottom of the page. Only content that still doesn't fit
    // after that (a copy block hit the 300-character cap but there were
    // still too many of them to fit — e.g. 10 Top Initiatives, or the row
    // landed on a page with little room left) has its overflow spilled
    // into its own full-width "[Box Title] (Cont.)" box right after the
    // row, via flowBoxLines — so nothing in the PDF ever gets clipped.
    function drawRow(keys) {
      const boxW = (pageWidth - MARGIN * 2 - GAP * (keys.length - 1)) / keys.length;
      const perBoxLines = keys.map((key) => buildPdfLines(key, run.boxes));
      let idealHeight = 0;
      perBoxLines.forEach((lines) => {
        idealHeight = Math.max(idealHeight, boxHeightForLines(doc, lines, boxW));
      });
      // Safety cap: never ask for a row taller than a full fresh page can
      // hold — drawBox's own ellipsis clip is only the last-resort net for
      // a single line taller than an entire fresh page.
      const maxFreshPageHeight = pageHeight - MARGIN * 2 - 40;
      let rowHeight = Math.min(idealHeight, maxFreshPageHeight);

      if (y + rowHeight > pageHeight - MARGIN) {
        doc.addPage();
        y = drawContinuationHeader();
      }

      rowHeight = growRowHeightToFitPage(y, rowHeight, idealHeight);

      const availableContentHeight = rowHeight - BOX_CHROME_TOP - BOX_BOTTOM_PAD;
      const overflow = []; // { key, lines } for any box that didn't fully fit at rowHeight
      const chunks = keys.map((key, i) => {
        const { chunk, remaining } = splitLinesForHeight(
          doc,
          perBoxLines[i],
          boxW - BOX_PAD_X * 2,
          availableContentHeight
        );
        if (remaining.length > 0) overflow.push({ key, lines: remaining });
        return chunk;
      });

      keys.forEach((key, i) => {
        drawBox(doc, {
          x: MARGIN + i * (boxW + GAP),
          y,
          w: boxW,
          h: rowHeight,
          title: boxTitles[key],
          lines: chunks[i],
          accentRgb,
        });
      });
      y += rowHeight + GAP;

      overflow.forEach(({ key, lines }) => {
        flowBoxLines(boxTitles[key], lines, { startAsContinuation: true });
      });
    }

    // Customer References and Pricing Overview are usually short, which
    // used to leave a lot of empty page space under them while Key
    // Talking Points got pushed into its own full-width section below the
    // whole grid. Instead: keep the row's height the same as it would
    // otherwise be, but only give Customer References and Pricing
    // Overview the top half of it; the bottom half, spanning both of
    // their columns, is where Key Talking Points starts. This only makes
    // sense because those two boxes are always drawn side by side on the
    // same page as part of this one row (drawRow's page-break logic below
    // moves the WHOLE row together, never splits it) — if that ever
    // stopped being true this function would need to fall back to the
    // plain drawRow + separate flowing box arrangement used for row 1.
    function drawSecondRowWithTalkingPoints() {
      const keys = ["whereWeWin", "competitorChallenges", "customerReferences", "pricing"];
      const boxW = (pageWidth - MARGIN * 2 - GAP * (keys.length - 1)) / keys.length;
      const perBoxLines = keys.map((key) => buildPdfLines(key, run.boxes));
      const talkingPointsW = boxW * 2 + GAP;
      const talkingPointsAllLines = buildPdfLines("talkingPoints", run.boxes);

      // Ideal (uncapped) height each side of the row would need to show
      // everything with zero overflow — used both for the pre-existing
      // "how tall should this row start out" sizing and, below, to know
      // how far it's worth growing the row toward the bottom of the page.
      // Customer References / Pricing Overview and Key Talking Points
      // only ever get HALF the row's height, so the row needs to be
      // roughly twice as tall as either of those needs on its own.
      let idealFullHeight = 0; // drives Where We Win / Competitor Considerations (full row height)
      [perBoxLines[0], perBoxLines[1]].forEach((lines) => {
        idealFullHeight = Math.max(idealFullHeight, boxHeightForLines(doc, lines, boxW));
      });
      let idealHalfHeight = 0; // drives Customer References / Pricing Overview (half row height)
      [perBoxLines[2], perBoxLines[3]].forEach((lines) => {
        idealHalfHeight = Math.max(idealHalfHeight, boxHeightForLines(doc, lines, boxW));
      });
      const idealTalkingPointsHeight = boxHeightForLines(doc, talkingPointsAllLines, talkingPointsW);

      const maxFreshPageHeight = pageHeight - MARGIN * 2 - 40;
      // Floor: with the row split in two, each half still needs room for
      // its own title chrome plus a few lines, or Customer References /
      // Pricing Overview / the first Key Talking Points chunk would have
      // no usable space at all.
      const minRowHeight = 2 * (BOX_CHROME_TOP + BOX_BOTTOM_PAD + 20) + GAP;
      const idealRowHeight = Math.max(
        idealFullHeight,
        2 * idealHalfHeight,
        2 * (idealTalkingPointsHeight + GAP),
        minRowHeight
      );
      let rowHeight = Math.min(idealRowHeight, maxFreshPageHeight);

      if (y + rowHeight > pageHeight - MARGIN) {
        doc.addPage();
        y = drawContinuationHeader();
      }

      // Grow toward the bottom of this page before giving up any content
      // to a "(Cont.)" box — same rule as drawRow, and the main reason
      // Key Talking Points used to be cramped even with blank page space
      // left below it.
      rowHeight = growRowHeightToFitPage(y, rowHeight, idealRowHeight);

      const rowY = y;
      const halfHeight = rowHeight / 2;
      const talkingPointsHeight = rowHeight - halfHeight - GAP;
      const overflow = []; // { key, lines } for any box that didn't fully fit

      // Where We Win / Competitor Considerations: unchanged, full row height.
      ["whereWeWin", "competitorChallenges"].forEach((key, i) => {
        const availableContentHeight = rowHeight - BOX_CHROME_TOP - BOX_BOTTOM_PAD;
        const { chunk, remaining } = splitLinesForHeight(doc, perBoxLines[i], boxW - BOX_PAD_X * 2, availableContentHeight);
        if (remaining.length > 0) overflow.push({ key, lines: remaining });
        drawBox(doc, { x: MARGIN + i * (boxW + GAP), y: rowY, w: boxW, h: rowHeight, title: boxTitles[key], lines: chunk, accentRgb });
      });

      // Customer References / Pricing Overview: half height.
      ["customerReferences", "pricing"].forEach((key, i) => {
        const idx = i + 2;
        const availableContentHeight = halfHeight - BOX_CHROME_TOP - BOX_BOTTOM_PAD;
        const { chunk, remaining } = splitLinesForHeight(doc, perBoxLines[idx], boxW - BOX_PAD_X * 2, availableContentHeight);
        if (remaining.length > 0) overflow.push({ key, lines: remaining });
        drawBox(doc, { x: MARGIN + idx * (boxW + GAP), y: rowY, w: boxW, h: halfHeight, title: boxTitles[key], lines: chunk, accentRgb });
      });

      // Key Talking Points: starts in the freed space below Customer
      // References + Pricing Overview, spanning both of their columns.
      const talkingPointsX = MARGIN + 2 * (boxW + GAP);
      const talkingPointsAvailableHeight = talkingPointsHeight - BOX_CHROME_TOP - BOX_BOTTOM_PAD;
      const { chunk: tpChunk, remaining: tpRemaining } = splitLinesForHeight(
        doc,
        talkingPointsAllLines,
        talkingPointsW - BOX_PAD_X * 2,
        talkingPointsAvailableHeight
      );
      drawBox(doc, {
        x: talkingPointsX,
        y: rowY + halfHeight + GAP,
        w: talkingPointsW,
        h: talkingPointsHeight,
        title: boxTitles.talkingPoints,
        lines: tpChunk,
        accentRgb,
      });

      y = rowY + rowHeight + GAP;

      // Anything that didn't fit — Where We Win / Competitor Considerations
      // overflow, Customer References / Pricing Overview overflow, or the
      // rest of Key Talking Points — spills into full-width "(Cont.)"
      // boxes right after the row, in reading order.
      overflow.forEach(({ key, lines }) => {
        flowBoxLines(boxTitles[key], lines, { startAsContinuation: true });
      });
      if (tpRemaining.length > 0) {
        flowBoxLines(boxTitles.talkingPoints, tpRemaining, { startAsContinuation: true });
      }
    }

    // Row 1 is a plain 4-box row. Row 2 folds Key Talking Points in below
    // Customer References / Pricing Overview instead of giving it its own
    // full-width section — see drawSecondRowWithTalkingPoints above —
    // which is what keeps a normal-sized battle card to 1-2 pages.
    drawRow(["competitorProduct", "ourFeatures", "theirFeatures", "topInitiatives"]);
    drawSecondRowWithTalkingPoints();

    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i += 1) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(150, 150, 155);
      doc.text(`Instant Battle Card Generator — Page ${i} of ${pageCount}`, pageWidth - MARGIN, pageHeight - 12, {
        align: "right",
      });
    }

    doc.save(`battle-card-${slugify(run.competitorName)}.pdf`);
  }

  savePdfBtn.addEventListener("click", function () {
    if (!lastRunData) return;
    savePdfBtn.disabled = true;
    savePdfBtn.textContent = "Preparing PDF…";
    try {
      buildPdf(lastRunData);
    } catch (err) {
      showAlert("Could not generate the PDF. Please try again.");
    } finally {
      savePdfBtn.disabled = false;
      savePdfBtn.textContent = "Create Battle Card PDF";
    }
  });

  // Starts disabled until a successful run populates lastRunData.
  disablePdfButton();
})();
