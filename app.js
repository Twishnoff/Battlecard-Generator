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
    el.innerHTML = `<ul>${items.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`;
  }

  function renderWinLoseTable(el, items, { competeFlag } = {}) {
    if (!items || items.length === 0) {
      emptyState(el);
      return;
    }
    el.removeAttribute("data-state");
    const rows = items
      .map((i) => {
        const compete = competeFlag && i.whereWeCompete ? '<div class="tag-compete">Where We Compete</div>' : "";
        return `<tr><td><strong>${escapeHtml(i.feature)}</strong>${compete}</td><td>${escapeHtml(i.explanation)}</td></tr>`;
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

  // Builds the plain-text body lines for a given box, shared by the PDF
  // renderer. Each line is { bold, text, gapAfter }.
  function buildPdfLines(boxKey, boxes) {
    const lines = [];
    const push = (text, bold, gapAfter) => lines.push({ text, bold: !!bold, gapAfter: gapAfter || 4 });

    if (boxKey === "competitorProduct") {
      const cp = boxes.competitorProduct || {};
      push(`Competitor Name: ${cp.competitorName || "—"}`, false, 6);
      push(`Value Proposition: ${cp.valueProposition || "—"}`, false, 6);
      push(`Primary Products: ${cp.primaryProducts || "—"}`, false, 6);
    } else if (boxKey === "ourFeatures" || boxKey === "theirFeatures") {
      const items = boxes[boxKey] || [];
      if (items.length === 0) push("No Relevant Results Found", false, 4);
      items.forEach((i) => {
        push(i.name, true, 2);
        push(i.description, false, 6);
      });
    } else if (boxKey === "topInitiatives") {
      const items = boxes.topInitiatives || [];
      if (items.length === 0) push("No Relevant Results Found", false, 4);
      items.forEach((t) => push(`• ${t}`, false, 5));
    } else if (boxKey === "whereWeWin" || boxKey === "competitorChallenges") {
      const items = boxes[boxKey] || [];
      if (items.length === 0) push("No Relevant Results Found", false, 4);
      items.forEach((i) => {
        const tag = boxKey === "competitorChallenges" && i.whereWeCompete ? "  [Where We Compete]" : "";
        push(`${i.feature}${tag}`, true, 2);
        push(i.explanation, false, 6);
      });
    } else if (boxKey === "customerReferences") {
      const items = boxes.customerReferences || [];
      if (items.length === 0) push("No Relevant Results Found", false, 4);
      items.forEach((i) => push(`• ${i.name}${i.inIndustry ? "  (In Industry)" : ""}`, false, 5));
    } else if (boxKey === "pricing") {
      const p = boxes.pricing || {};
      push(p.summary || "Refer to internal documentation for pricing.", false, 6);
    } else if (boxKey === "talkingPoints") {
      const items = boxes.talkingPoints || [];
      if (items.length === 0) push("No Relevant Results Found", false, 4);
      items.forEach((i) => {
        push(`Q: ${i.question}`, true, 2);
        push(`A: ${i.answer}`, false, 8);
      });
    }
    return lines;
  }

  // Draws one box (border + title + wrapped body lines, clipped to height).
  function drawBox(doc, { x, y, w, h, title, lines, accentRgb }) {
    doc.setDrawColor(226, 226, 230);
    doc.setLineWidth(0.75);
    doc.roundedRect(x, y, w, h, 4, 4);

    doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.rect(x, y, w, 3, "F");

    const pad = 10;
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
    const margin = 30;
    const accentRgb = hexToRgb(run.brandColor);

    let y = margin;

    // Logo (top-left), if available.
    const titleStartX = margin;
    if (run.logoDataUri) {
      try {
        doc.addImage(run.logoDataUri, titleStartX, y, 36, 36, undefined, "FAST");
      } catch (err) {
        // Unsupported format or corrupt data URI — silently skip the logo.
      }
    }

    // Centered title bar.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(31, 32, 35);
    doc.text(`Competitive Battle Card: ${run.competitorName}`, pageWidth / 2, y + 24, { align: "center" });
    y += 46;

    doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.setLineWidth(2);
    doc.line(margin, y, pageWidth - margin, y);
    y += 18;

    // Info strip.
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
    doc.text(doc.splitTextToSize(infoLine, pageWidth - margin * 2), margin, y);
    y += 26;

    // 2 rows x 4 boxes, then one full-width box.
    const gap = 10;
    const cols = 4;
    const boxW = (pageWidth - margin * 2 - gap * (cols - 1)) / cols;
    const rowH = 150;
    const talkingPointsH = pageHeight - y - rowH * 2 - gap * 2 - margin;

    const row1Keys = ["competitorProduct", "ourFeatures", "theirFeatures", "topInitiatives"];
    const row2Keys = ["whereWeWin", "competitorChallenges", "customerReferences", "pricing"];

    row1Keys.forEach((key, i) => {
      drawBox(doc, {
        x: margin + i * (boxW + gap),
        y,
        w: boxW,
        h: rowH,
        title: BOX_TITLES[key],
        lines: buildPdfLines(key, run.boxes),
        accentRgb,
      });
    });
    y += rowH + gap;

    row2Keys.forEach((key, i) => {
      drawBox(doc, {
        x: margin + i * (boxW + gap),
        y,
        w: boxW,
        h: rowH,
        title: BOX_TITLES[key],
        lines: buildPdfLines(key, run.boxes),
        accentRgb,
      });
    });
    y += rowH + gap;

    drawBox(doc, {
      x: margin,
      y,
      w: pageWidth - margin * 2,
      h: Math.max(talkingPointsH, 90),
      title: BOX_TITLES.talkingPoints,
      lines: buildPdfLines("talkingPoints", run.boxes),
      accentRgb,
    });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(150, 150, 155);
    doc.text(`Generated by Instant Battle Card Generator`, pageWidth - margin, pageHeight - 12, { align: "right" });

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
