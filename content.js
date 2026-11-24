(() => {
  // If an older copy is already running in this page, the page needs a refresh
  if (window.__vffLoaded) return;
  window.__vffLoaded = true;

  const SELECTOR =
    'input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="search"], input[type="url"], input:not([type]), textarea';

  // For reading aloud we also describe password fields (we never fill them)
  const DESCRIBE_SELECTOR = SELECTOR + ', input[type="password"]';

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (
      r.width > 0 && r.height > 0 &&
      s.visibility !== "hidden" && s.display !== "none" &&
      !el.disabled && !el.readOnly
    );
  }

  function cleanLabel(text) {
    return text.replace(/[*:]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  }

  function getLabelText(el) {
    let text = "";
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) text = label.innerText;
    }
    if (!text) {
      const wrapping = el.closest("label");
      if (wrapping) text = wrapping.innerText;
    }
    if (!text) text = el.getAttribute("aria-label") || el.placeholder || el.name || "";
    return cleanLabel(text) || "unnamed field";
  }

  // A plain-English name for the kind of field
  function kindOf(el) {
    if (el.tagName === "TEXTAREA") return "long text";
    switch ((el.getAttribute("type") || "text").toLowerCase()) {
      case "email": return "email address";
      case "password": return "password";
      case "tel": return "phone number";
      case "number": return "number";
      case "search": return "search box";
      case "url": return "web address";
      default: return "text";
    }
  }

  function setValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findById(id) {
    return document.querySelector(`[data-vff-id="${id}"]`);
  }

  function visibleText(selector, limit) {
    const seen = new Set();
    return [...document.querySelectorAll(selector)]
      .filter(isVisible)
      .map((el) => (el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim())
      .filter((t) => t && t.length < 80 && !seen.has(t) && seen.add(t))
      .slice(0, limit);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // ---- fill flow (unchanged behaviour) ----
    if (message.action === "scan") {
      const fields = [...document.querySelectorAll(SELECTOR)]
        .filter(isVisible)
        .map((el, i) => {
          el.dataset.vffId = String(i);
          return { id: i, label: getLabelText(el) };
        });
      sendResponse({ fields });
    }

    if (message.action === "focus") {
      const el = findById(message.id);
      if (el) {
        el.scrollIntoView({ block: "center" });
        el.focus();
        el.style.outline = "3px solid orange";
      }
      sendResponse({ ok: !!el });
    }

    if (message.action === "fillFields") {
      let count = 0;
      message.values.forEach(({ id, value }) => {
        const el = findById(id);
        if (el) {
          setValue(el, value);
          el.style.outline = "";
          el.style.border = "3px solid green";
          count++;
        }
      });
      sendResponse({ count, total: message.values.length });
    }

    // ---- NEW: describe the page for reading aloud ----
    if (message.action === "describe") {
      const fields = [...document.querySelectorAll(DESCRIBE_SELECTOR)]
        .filter(isVisible)
        .map((el, i) => {
          el.dataset.vffRead = String(i);
          return {
            readId: i,
            label: getLabelText(el),
            kind: kindOf(el),
            required: el.required || el.getAttribute("aria-required") === "true",
          };
        });

      const radioGroups = new Set(
        [...document.querySelectorAll('input[type="radio"]')]
          .filter(isVisible)
          .map((r) => r.name || Math.random())
      );

      sendResponse({
        title: document.title.trim().slice(0, 80),
        headings: visibleText("h1, h2, legend", 3),
        fields,
        buttons: visibleText('button, input[type="submit"], input[type="button"], [role="button"]', 6),
        others: {
          dropdowns: [...document.querySelectorAll("select")].filter(isVisible).length,
          checkboxes: [...document.querySelectorAll('input[type="checkbox"]')].filter(isVisible).length,
          radioGroups: radioGroups.size,
        },
      });
    }

    // highlight the field currently being read
    if (message.action === "focusRead") {
      document.querySelectorAll("[data-vff-read]").forEach((e) => (e.style.outline = ""));
      const el = document.querySelector(`[data-vff-read="${message.readId}"]`);
      if (el) {
        el.scrollIntoView({ block: "center" });
        el.style.outline = "3px solid orange";
      }
      sendResponse({ ok: !!el });
    }

    if (message.action === "clearRead") {
      document.querySelectorAll("[data-vff-read]").forEach((e) => (e.style.outline = ""));
      sendResponse({ ok: true });
    }
  });
})();