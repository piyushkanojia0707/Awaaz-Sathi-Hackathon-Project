/**
 * Screen AI — screen.js
 *
 * Captures the current tab's video stream, lets the user take snapshots,
 * and sends them together with a text question to the Gemini Vision API
 * (gemini-1.5-flash by default) for analysis.
 *
 * Permissions required in manifest.json:
 *   "tabCapture", "storage", "activeTab", "scripting"
 *
 * No server needed — calls the Gemini REST API directly from the
 * extension popup context (which has network access).
 */


"use strict";

// ── DOM refs ────────────────────────────────────────────────────────────────
const liveDot       = document.getElementById("liveDot");
const statusBadge   = document.getElementById("statusBadge");
const previewCanvas = document.getElementById("preview");
const previewWrap   = document.getElementById("previewWrap");
const placeholder   = document.getElementById("previewPlaceholder");
const snapOverlay   = document.getElementById("snapshotOverlay");
const startBtn      = document.getElementById("startBtn");
const snapBtn       = document.getElementById("snapBtn");
const stopBtn       = document.getElementById("stopBtn");
const chat          = document.getElementById("chat");
const userInput     = document.getElementById("userInput");
const sendBtn       = document.getElementById("sendBtn");
const micBtn        = document.getElementById("micBtn");
const apiKeyInput   = document.getElementById("apiKeyInput");
const saveKeyBtn    = document.getElementById("saveKeyBtn");

// ── State ────────────────────────────────────────────────────────────────────
let mediaStream     = null;
let videoEl         = null;
let rafId           = null;         // requestAnimationFrame loop id
let lastSnapshot    = null;         // base64 JPEG of the latest snapshot
let geminiKey       = "";
let isThinking      = false;
let recognition     = null;

const GEMINI_MODEL  = "gemini-1.5-flash";
const GEMINI_URL    = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function setStatus(text, mode /* "idle"|"live"|"thinking" */) {
  statusBadge.textContent = text;
  liveDot.className = "dot" + (mode === "live" ? " live" : mode === "thinking" ? " thinking" : "");
}

function addMsg(role /* "user"|"ai"|"sys" */, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

function flashOverlay() {
  snapOverlay.classList.add("flash");
  setTimeout(() => snapOverlay.classList.remove("flash"), 180);
}

function canvasToJpeg(canvas, quality = 0.82) {
  return canvas.toDataURL("image/jpeg", quality).split(",")[1]; // base64 only
}

// ── API Key persistence — uses localStorage (always available, no permission needed) ──

(function loadSavedKey() {
  try {
    const saved = localStorage.getItem("neurithm_gemini_key");
    if (saved) {
      geminiKey = saved;
      apiKeyInput.placeholder = "API key already saved ✓";
    }
  } catch (e) { /* ignore */ }
})();

saveKeyBtn.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    addMsg("sys", "⚠ Paste your Gemini API key in the box above, then click Save key.");
    return;
  }
  geminiKey = key;
  try { localStorage.setItem("neurithm_gemini_key", key); } catch (e) { /* ignore */ }
  apiKeyInput.placeholder = "API key saved ✓";
  apiKeyInput.value = "";
  addMsg("sys", "✓ API key saved! Now click ▶ Start capture.");
});

// ── Screen capture ───────────────────────────────────────────────────────────

async function startCapture() {
  if (!geminiKey) {
    addMsg("sys", "⚠ Please save your Gemini API key before starting.");
    return;
  }

  try {
    // getDisplayMedia works in extension popup pages in MV3
    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 5, width: { ideal: 1280 } },
      audio: false,
    });
  } catch (err) {
    addMsg("sys", `✗ Screen share cancelled or denied: ${err.message}`);
    return;
  }

  // Hidden <video> element to decode the stream
  videoEl = document.createElement("video");
  videoEl.srcObject = mediaStream;
  videoEl.muted = true;
  videoEl.playsInline = true;
  await videoEl.play();

  // Show canvas
  placeholder.style.display = "none";
  previewCanvas.style.display = "block";

  setStatus("live", "live");
  startBtn.disabled = true;
  snapBtn.disabled  = false;
  stopBtn.disabled  = false;
  sendBtn.disabled  = false;

  addMsg("sys", "🟢 Screen capture started. Ask a question or click 📸 Snapshot + Ask.");

  // Draw live frames into the canvas (low-rate preview)
  drawLoop();

  // Auto-stop if the user ends screen share from the browser chrome
  mediaStream.getVideoTracks()[0].addEventListener("ended", stopCapture);
}

function drawLoop() {
  if (!mediaStream) return;

  const ctx = previewCanvas.getContext("2d");
  const vw  = videoEl.videoWidth  || 1280;
  const vh  = videoEl.videoHeight || 720;

  previewCanvas.width  = vw;
  previewCanvas.height = vh;
  ctx.drawImage(videoEl, 0, 0, vw, vh);

  rafId = requestAnimationFrame(drawLoop);
}

function stopCapture() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  if (videoEl) { videoEl.srcObject = null; videoEl = null; }

  previewCanvas.style.display = "none";
  placeholder.style.display   = "block";

  setStatus("idle", "idle");
  startBtn.disabled = false;
  snapBtn.disabled  = true;
  stopBtn.disabled  = true;
  sendBtn.disabled  = true;

  addMsg("sys", "⏹ Screen capture stopped.");
}

startBtn.addEventListener("click", startCapture);
stopBtn.addEventListener("click", stopCapture);

// ── Snapshot + Ask ───────────────────────────────────────────────────────────

async function askGemini(question, imageBase64) {
  if (!geminiKey) {
    addMsg("sys", "⚠ No Gemini API key set.");
    return;
  }

  isThinking = true;
  setStatus("thinking…", "thinking");

  const thinkingMsg = addMsg("ai", "⏳ Analysing your screen…");

  const parts = [];

  if (imageBase64) {
    parts.push({ inlineData: { mimeType: "image/jpeg", data: imageBase64 } });
  }

  parts.push({ text: question || "Describe what you see on screen in detail." });

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1024,
    },
    systemInstruction: {
      parts: [{
        text: "You are a helpful screen-reading AI assistant embedded in a Chrome extension. The user shares screenshots of their screen. Describe, explain, and answer questions about what you see clearly and concisely."
      }]
    }
  };

  try {
    const res = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const json = await res.json();

    if (!res.ok) {
      const errMsg = json?.error?.message || res.statusText;
      thinkingMsg.textContent = `✗ API error: ${errMsg}`;
      return;
    }

    const reply = json?.candidates?.[0]?.content?.parts?.[0]?.text || "(no response)";
    thinkingMsg.textContent = reply;
  } catch (err) {
    thinkingMsg.textContent = `✗ Network error: ${err.message}`;
  } finally {
    isThinking = false;
    setStatus("live", "live");
  }
}

// Snapshot button: take a frame NOW, then ask the current question (or a default)
snapBtn.addEventListener("click", async () => {
  if (!mediaStream) return;

  flashOverlay();

  // Capture current canvas frame
  lastSnapshot = canvasToJpeg(previewCanvas);

  const question = userInput.value.trim() || "What do you see on this screen? Describe it.";
  addMsg("user", `📸 ${question}`);
  userInput.value = "";

  await askGemini(question, lastSnapshot);
});

// Send button / Enter: use the most recent snapshot if available
sendBtn.addEventListener("click", sendQuestion);
userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQuestion(); }
});

async function sendQuestion() {
  if (isThinking) return;

  const question = userInput.value.trim();
  if (!question) return;

  // If no snapshot yet, take one automatically
  if (mediaStream && !lastSnapshot) {
    flashOverlay();
    lastSnapshot = canvasToJpeg(previewCanvas);
  }

  addMsg("user", question);
  userInput.value = "";

  await askGemini(question, lastSnapshot);
}

// ── Voice input ───────────────────────────────────────────────────────────────

micBtn.addEventListener("click", () => {
  if (recognition) {
    recognition.stop();
    return;
  }

  const SpeechAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechAPI) {
    addMsg("sys", "⚠ Speech recognition is not supported in this browser.");
    return;
  }

  recognition = new SpeechAPI();
  recognition.lang = "en-IN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  micBtn.classList.add("recording");
  micBtn.title = "Recording… click to stop";

  recognition.onresult = (event) => {
    const text = event.results[0][0].transcript;
    userInput.value = text;
    userInput.focus();
  };

  recognition.onend = () => {
    recognition = null;
    micBtn.classList.remove("recording");
    micBtn.title = "Voice input";
  };

  recognition.onerror = () => {
    recognition = null;
    micBtn.classList.remove("recording");
    micBtn.title = "Voice input";
  };

  recognition.start();
});

// ── Auto-resize textarea ──────────────────────────────────────────────────────
userInput.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 100) + "px";
});

