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
    competitorChallenges: "Competitor Challenges",
    customerReferences: "Customer References",
    talkingPoints: "Key Talking Points",
    pricing: "Pricing Overview",
  };

  const boxEls = {};
  Object.keys(BOX_TITLES).forEach((key) => {
    boxEls[key] = document.querySelector(`#box-${key} .box-body`);
  });

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
  }

  function resetBoxesToNoData() {
    allBoxElements().forEach((el) => {
      el.setAttribute("data-state", "empty");
      el.textContent = "No Data Collected";
    });
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
      <div class="kv-line"><span class="kv-label">Value Proposition:</span> ${escapeHtml(cp.valueProposition || "—")}</div>
      <div class="kv-line"><span class="kv-label">Primary Products:</span> ${escapeHtml(cp.primaryProducts || "—")}</div>
    `;
  }

  function renderFeatureTable(el, items) {
    if (!items || items.length === 0) {
      emptyState(el);
      return;
    }
    el.removeAttribute("data-state");
    const rows = items
      .map((i) => `<tr><td><strong>${escapeHtml(i.name)}</strong></td><td>${escapeHtml(i.description)}</td></tr>`)
      .join("");
    el.innerHTML = `<table><tbody>${rows}</tbody></table>`;
  }

  function renderInitiatives(el, items) {
    if (!items || items.length === 0) {
      emptyState(el);
      return;
    }
    el.removeAttribute("data-state");
    el.innerHTML = `<ol class="lettered-list">${items.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ol>`;
  }

  // "initiativeLetter" ties a feature back to the lettered Top Prospect
  // Initiatives list — rendered as a badge under the feature name (not
  // beside the explanation copy), matching that same A/B/C/... lettering.
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
        return `<tr><td><strong>${escapeHtml(i.feature)}</strong>${badge}${compete}</td><td>${escapeHtml(
          i.explanation
        )}</td></tr>`;
      })
      .join("");
    el.innerHTML = `<table><tbody>${rows}</tbody></table>`;
  }

  function renderCustomerReferences(el, items) {
    if (!items || items.length === 0) {
      emptyState(el);
      return;
    }
    el.removeAttribute("data-state");
    const rows = items
      .map((i) => {
        const tag = i.inIndustry ? '<span class="tag-in-industry">In Industry</span>' : "";
        return `<tr><td>${escapeHtml(i.name)}${tag}</td></tr>`;
      })
      .join("");
    el.innerHTML = `<table><tbody>${rows}</tbody></table>`;
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
            i.answer
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
    el.innerHTML = `<div class="${cls}">${escapeHtml(p.summary)}</div>`;
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
  // PDF-only copy rule: every prose copy block (an answer, an
  // explanation, a description, ...) is capped at 280 characters here —
  // see PDF_COPY_LIMIT/pdfCopy below — even though the on-page HTML above
  // shows the full, uncapped copy. And if a box still has more copy than
  // fits on one page even after that cap (e.g. 10 Top Initiatives), the
  // rest spills into a same-named "[Box Title] (Cont.)" box rather than
  // getting clipped — see flowBoxLines below.

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

  // PDF-only rule: no single copy block (an answer, an explanation, a
  // description, etc.) may exceed 280 characters in the exported PDF, even
  // though the on-page HTML above shows the full, uncapped copy. The
  // backend is asked to hand back an already-condensed "<field>ForPdf"
  // version of every prose field (a real rewrite that keeps the strongest
  // proof point, not a mid-sentence cut), and every call site below prefers
  // that field. capTo280 is the client-side safety net for whatever slips
  // through uncapped (an older cached run, a field the model skipped, or a
  // condensed version that still came back slightly over budget) — it
  // trims to the last full sentence under the limit, falling back to the
  // last full word, so a box never gets cut off mid-word.
  const PDF_COPY_LIMIT = 280;

  function capTo280(text) {
    const t = String(text == null ? "" : text).trim();
    if (t.length <= PDF_COPY_LIMIT) return t;
    const slice = t.slice(0, PDF_COPY_LIMIT);
    const lastSentenceEnd = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
    if (lastSentenceEnd > PDF_COPY_LIMIT / 2) return slice.slice(0, lastSentenceEnd + 1).trim();
    const lastSpace = slice.lastIndexOf(" ");
    const base = lastSpace > PDF_COPY_LIMIT / 2 ? slice.slice(0, lastSpace) : slice.slice(0, PDF_COPY_LIMIT - 1);
    return `${base.trim()}…`;
  }

  // Prefers the backend's condensed "ForPdf" copy for a field, falling back
  // to a locally-capped version of the full copy when it's missing.
  function pdfCopy(condensed, full) {
    return capTo280(condensed || full);
  }

  // Builds the plain-text body lines for a given box, shared by the PDF
  // renderer. Each line is { bold, text, gapAfter }. Mirrors the on-page
  // HTML rendering above, except every prose copy block is capped to 280
  // characters (see PDF_COPY_LIMIT above) — the on-page HTML always shows
  // the full, uncapped copy. buildPdf below paginates on top of that, and
  // overflows any box that still doesn't fit into a "(Cont.)" box.
  function buildPdfLines(boxKey, boxes) {
    const lines = [];
    const push = (text, bold, gapAfter) => lines.push({ text, bold: !!bold, gapAfter: gapAfter || 4 });

    if (boxKey === "competitorProduct") {
      const cp = boxes.competitorProduct || {};
      push(`Competitor Name: ${cp.competitorName || "—"}`, false, 6);
      push(`Value Proposition: ${pdfCopy(cp.valuePropositionForPdf, cp.valueProposition) || "—"}`, false, 6);
      push(`Primary Products: ${pdfCopy(cp.primaryProductsForPdf, cp.primaryProducts) || "—"}`, false, 6);
    } else if (boxKey === "ourFeatures" || boxKey === "theirFeatures") {
      const items = boxes[boxKey] || [];
      if (items.length === 0) push("No Relevant Results Found", false, 4);
      items.forEach((i) => {
        push(i.name, true, 2);
        push(pdfCopy(i.descriptionForPdf, i.description), false, 6);
      });
    } else if (boxKey === "topInitiatives") {
      const items = boxes.topInitiatives || [];
      const pdfItems = boxes.topInitiativesForPdf || [];
      if (items.length === 0) push("No Relevant Results Found", false, 4);
      items.forEach((t, idx) =>
        push(`${indexToLetter(idx) || idx + 1}. ${pdfCopy(pdfItems[idx], t)}`, false, 5)
      );
    } else if (boxKey === "whereWeWin" || boxKey === "competitorChallenges") {
      const items = boxes[boxKey] || [];
      if (items.length === 0) push("No Relevant Results Found", false, 4);
      items.forEach((i) => {
        const tag = boxKey === "competitorChallenges" && i.whereWeCompete ? "  [Where We Compete]" : "";
        push(`${i.feature}${tag}`, true, 2);
        if (i.initiativeLetter) push(`Ties to Initiative ${i.initiativeLetter}`, true, 3);
        push(pdfCopy(i.explanationForPdf, i.explanation), false, 6);
      });
    } else if (boxKey === "customerReferences") {
      const items = boxes.customerReferences || [];
      if (items.length === 0) push("No Relevant Results Found", false, 4);
      items.forEach((i) => push(`• ${i.name}${i.inIndustry ? "  (In Industry)" : ""}`, false, 5));
    } else if (boxKey === "pricing") {
      const p = boxes.pricing || {};
      push(pdfCopy(p.summaryForPdf, p.summary) || "Refer to internal documentation for pricing.", false, 6);
    } else if (boxKey === "talkingPoints") {
      const items = boxes.talkingPoints || [];
      if (items.length === 0) push("No Relevant Results Found", false, 4);
      items.forEach((i) => {
        push(`Q: ${i.question}`, true, 2);
        push(`A: ${pdfCopy(i.answerForPdf, i.answer)}`, false, 8);
      });
    }
    return lines;
  }

  // Chrome (title + divider) reserved at the top of every box, and a small
  // bottom pad — used both to measure how tall a box needs to be and to
  // know where its body text starts when actually drawing it.
  const BOX_CHROME_TOP = 35;
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
      doc.setTextColor(line.bold ? 31 : 70, line.bold ? 32 : 71, line.bold ? 35 : 78);
      const wrapped = doc.splitTextToSize(line.text, maxWidth);
      for (const wl of wrapped) {
        if (cursorY > bottomLimit) break;
        doc.text(wl, x + pad, cursorY);
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

    // Draws a row of equal-width boxes, sized to whichever box in the row
    // needs the most room, capped at a full fresh page's height, moving
    // the WHOLE row to a fresh page first if it wouldn't fit on the
    // current one. Any box whose content still doesn't fit within that
    // height (a copy block hit the 280-character cap but there were still
    // too many of them to fit — e.g. 10 Top Initiatives) has its overflow
    // spilled into its own full-width "[Box Title] (Cont.)" box right
    // after the row, via flowBoxLines — so nothing in the PDF ever gets
    // clipped.
    function drawRow(keys) {
      const boxW = (pageWidth - MARGIN * 2 - GAP * (keys.length - 1)) / keys.length;
      const perBoxLines = keys.map((key) => buildPdfLines(key, run.boxes));
      let rowHeight = 0;
      perBoxLines.forEach((lines) => {
        rowHeight = Math.max(rowHeight, boxHeightForLines(doc, lines, boxW));
      });
      // Safety cap: never ask for a row taller than a full fresh page can
      // hold — drawBox's own ellipsis clip is only the last-resort net for
      // a single line taller than an entire fresh page.
      const maxFreshPageHeight = pageHeight - MARGIN * 2 - 40;
      rowHeight = Math.min(rowHeight, maxFreshPageHeight);

      if (y + rowHeight > pageHeight - MARGIN) {
        doc.addPage();
        y = drawContinuationHeader();
      }

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
          title: BOX_TITLES[key],
          lines: chunks[i],
          accentRgb,
        });
      });
      y += rowHeight + GAP;

      overflow.forEach(({ key, lines }) => {
        flowBoxLines(BOX_TITLES[key], lines, { startAsContinuation: true });
      });
    }

    // 2 rows of 4 boxes (each spilling into its own "(Cont.)" box(es) if it
    // runs long), then one full-width flowing box for Key Talking Points.
    drawRow(["competitorProduct", "ourFeatures", "theirFeatures", "topInitiatives"]);
    drawRow(["whereWeWin", "competitorChallenges", "customerReferences", "pricing"]);
    flowBoxLines(BOX_TITLES.talkingPoints, buildPdfLines("talkingPoints", run.boxes));

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
