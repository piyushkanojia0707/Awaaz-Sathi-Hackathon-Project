const tabId = Number(new URLSearchParams(location.search).get("tabId"));
const $ = (id) => document.getElementById(id);

const startBtn = $("startBtn");
const progressEl = $("progress");
const questionEl = $("question");
const heardEl = $("heard");
const statusEl = $("status");
const languageSelect = $("language");
const reviewEl = $("review");
const reviewRows = $("reviewRows");
const readBtn = $("readBtn");

let LANG = "";
let reading = false;
let currentAnswers = [];
let cachedVoice;

function requireLanguage() {
  if (!languageSelect.value) {
    statusEl.textContent = "Please choose a language first.";
    languageSelect.focus();
    return false;
  }

  LANG = languageSelect.value;
  return true;
}

const YES = /\b(yes|yeah|yep|correct|right|haan|han|ha|sahi)\b|हाँ|हां|सही|जी\s*हाँ/i;
const SKIP = /^(skip|next|chhodo|छोड़ो|छोड़ें|अगला)$/i;
const BACK_CMD = /^(go\s+)?(back|previous|wapas|piche|peeche|वापस|पीछे|पिछला)$/i;
const BACK = Symbol("back");

const DIGIT_WORDS = {
  zero: 0, oh: 0, o: 0, shunya: 0, शून्य: 0,
  one: 1, ek: 1, एक: 1,
  two: 2, to: 2, too: 2, do: 2, दो: 2,
  three: 3, teen: 3, तीन: 3,
  four: 4, for: 4, char: 4, chaar: 4, चार: 4,
  five: 5, paanch: 5, panch: 5, पाँच: 5, पांच: 5,
  six: 6, chhe: 6, che: 6, chah: 6, छह: 6,
  seven: 7, saat: 7, sat: 7, सात: 7,
  eight: 8, ate: 8, aath: 8, ath: 8, आठ: 8,
  nine: 9, nau: 9, नौ: 9
};

function spokenToDigits(text) {
  const words = text
    .toLowerCase()
    .replace(/[०-९]/g, (digit) => "०१२३४५६७८९".indexOf(digit))
    .split(/[\s,.-]+/);

  let result = "";

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    if (word === "double" || word === "triple") {
      const next = words[i + 1];
      const digit = /^\d$/.test(next) ? next : DIGIT_WORDS[next];

      if (digit !== undefined) {
        result += String(digit).repeat(word === "double" ? 2 : 3);
        i++;
      }
    } else if (/^\d+$/.test(word)) {
      result += word;
    } else if (Object.hasOwn(DIGIT_WORDS, word)) {
      result += DIGIT_WORDS[word];
    }
  }

  return result;
}

const SAFE_SYMBOLS = [
  [/\b(hash\s?tag|hash\s+sign|hash|pound\s+sign|number\s+sign)\b/gi, "#"],
  [/\b(at\s+the\s+rate(\s+of)?)\b/gi, "@"],
  [/\bunder\s?score\b/gi, "_"],
  [/\b(back\s?slash)\b/gi, "\\"],
  [/\b(forward\s+slash|slash)\b/gi, "/"],
  [/\bampersand\b/gi, "&"],
  [/\b(dollar\s+sign)\b/gi, "$"],
  [/\b(percent\s+sign|percentage\s+sign)\b/gi, "%"],
  [/\b(asterisk|star\s+sign)\b/gi, "*"],
  [/\bplus\s+sign\b/gi, "+"],
  [/\bequals?\s+sign\b/gi, "="],
  [/\b(exclamation\s+mark)\b/gi, "!"]
];

const CODE_SYMBOLS = [
  [/\s+at\s+/gi, "@"],
  [/\b(dot|period|full\s+stop)\b/gi, "."],
  [/\b(dash|hyphen|minus)\b/gi, "-"],
  [/\bcomma\b/gi, ","]
];

function applySymbols(text, compact) {
  let result = text;

  SAFE_SYMBOLS.forEach(([pattern, symbol]) => {
    result = result.replace(pattern, ` ${symbol} `);
  });

  if (compact) {
    CODE_SYMBOLS.forEach(([pattern, symbol]) => {
      result = result.replace(pattern, ` ${symbol} `);
    });

    return result.replace(/\s+/g, "");
  }

  return result
    .replace(/\s*([#@_\\/&$%*+=!])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function fieldType(label) {
  const text = label.toLowerCase();

  if (/e-?mail|ईमेल/.test(text)) return "email";
  if (/aadhaar|aadhar|आधार/.test(text)) return "aadhaar";
  if (/\bpin\b|zip|postal|पिन|डाक/.test(text)) return "pin";
  if (/phone|mobile|contact|whatsapp|\btel\b|फोन|मोबाइल|संपर्क/.test(text)) return "phone";
  if (/user\s?name|user\s?id|password|passcode|handle|\bid\b|code|captcha|link|url|website/.test(text)) {
    return "code";
  }

  return "text";
}

const DIGIT_LENGTH = {
  phone: 10,
  pin: 6,
  aadhaar: 12
};

function hindiFieldLabel(label) {
  const rules = [
    [/\b(full\s+name|name)\b|नाम/i, "पूरा नाम"],
    [/\bage\b|उम्र|आयु/i, "उम्र"],
    [/\b(date of birth|birth date|dob)\b|जन्म.?तिथि/i, "जन्मतिथि"],
    [/\b(phone|mobile|contact)\b|फोन|मोबाइल/i, "मोबाइल नंबर"],
    [/\be-?mail\b|ईमेल/i, "ईमेल पता"],
    [/\baddress\b|पता/i, "पता"],
    [/\bscheme\b|योजना/i, "योजना का नाम"],
    [/\bapplication number\b|आवेदन संख्या/i, "आवेदन संख्या"],
    [/\bgender\b|लिंग/i, "लिंग"],
    [/\baadhaar|aadhar\b|आधार/i, "आधार नंबर"],
    [/\bpin\b|zip|postal|पिन|डाक/i, "पिन कोड"]
  ];

  const match = rules.find(([pattern]) => pattern.test(label));
  return match ? match[1] : label;
}

function fieldQuestion(label) {
  if (LANG !== "hi-IN") return label;

  const field = hindiFieldLabel(label);
  const lower = field.toLowerCase();

  if (lower === "पूरा नाम") return "आपका पूरा नाम क्या है?";
  if (lower === "उम्र") return "आपकी उम्र क्या है?";
  if (lower === "जन्मतिथि") return "आपकी जन्मतिथि क्या है?";
  if (lower === "मोबाइल नंबर") return "आपका मोबाइल नंबर क्या है?";
  if (lower === "ईमेल पता") return "आपका ईमेल पता क्या है?";
  if (lower === "पता") return "आपका पता क्या है?";
  if (lower === "योजना का नाम") return "योजना का नाम क्या है?";
  if (lower === "आवेदन संख्या") return "आपकी आवेदन संख्या क्या है?";
  if (lower === "लिंग") return "आपका लिंग क्या है?";
  if (lower === "आधार नंबर") return "आपका आधार नंबर क्या है?";
  if (lower === "पिन कोड") return "आपका पिन कोड क्या है?";

  return `इस फ़ील्ड का नाम ${label} है।`;
}

function cleanAnswer(label, text) {
  const type = fieldType(label);

  if (type === "email") {
    const value = applySymbols(text.toLowerCase(), true);
    const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);

    return valid
      ? { value, type }
      : {
          error: LANG === "hi-IN"
            ? "यह ईमेल पता सही नहीं लग रहा है।"
            : "That does not look like an email address.",
          type
        };
  }

  if (DIGIT_LENGTH[type]) {
    let digits = spokenToDigits(text);

    if (type === "phone") {
      if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
      if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
    }

    const requiredLength = DIGIT_LENGTH[type];

    return digits.length === requiredLength
      ? { value: digits, type }
      : {
          error: LANG === "hi-IN"
            ? `मुझे ${requiredLength} अंक चाहिए। आपने ${digits.length} अंक बताए।`
            : `I got ${digits.length} digits, but I need ${requiredLength}.`,
          type
        };
  }

  if (type === "code") {
    return { value: applySymbols(text, true), type };
  }

  return { value: applySymbols(text.trim(), false), type };
}

function pickVoice(lang) {
  if (cachedVoice !== undefined && cachedVoice?.lang?.startsWith(lang.split("-")[0])) {
    return cachedVoice;
  }

  const voices = speechSynthesis.getVoices();

  cachedVoice =
    voices.find((voice) => voice.lang === lang && voice.localService) ||
    voices.find((voice) => voice.lang === lang) ||
    voices.find((voice) => voice.lang.startsWith(lang.split("-")[0])) ||
    null;

  return cachedVoice;
}

speechSynthesis.onvoiceschanged = () => {
  cachedVoice = undefined;
};

function speak(text, lang = LANG) {
  return new Promise((resolve) => {
    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 1.05;

    const voice = pickVoice(lang);
    if (voice) utterance.voice = voice;

    utterance.onend = resolve;
    utterance.onerror = resolve;
    speechSynthesis.speak(utterance);
  });
}

function listen(lang = LANG, silenceMs = 900) {
  return new Promise((resolve, reject) => {
    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      reject(new Error("Speech recognition is not supported in this browser."));
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let latestText = "";
    let timer = null;
    let finished = false;

    const finish = (text, error) => {
      if (finished) return;

      finished = true;
      clearTimeout(timer);

      try {
        recognition.abort();
      } catch {}

      if (text) {
        resolve(text);
      } else {
        reject(new Error(error || "no-speech"));
      }
    };

    recognition.onresult = (event) => {
      latestText = [...event.results]
        .map((result) => result[0].transcript)
        .join(" ")
        .trim();

      clearTimeout(timer);

      if (event.results[event.results.length - 1].isFinal) {
        finish(latestText);
      } else {
        timer = setTimeout(() => finish(latestText), silenceMs);
      }
    };

    recognition.onerror = (event) => finish(latestText, event.error);
    recognition.onend = () => finish(latestText, "no-speech");
    recognition.start();
  });
}

async function ensureMic() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}

async function sendToPage(message) {
  if (!Number.isInteger(tabId)) {
    throw new Error("The webpage tab could not be identified. Reopen voice mode from the extension.");
  }

  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });

    return await chrome.tabs.sendMessage(tabId, message);
  }
}

function confirmationText(value) {
  if (LANG === "hi-IN") {
    return `${value}. क्या यह सही है?`;
  }

  return `${value}. Correct?`;
}

async function askField(label, confirm) {
  const type = fieldType(label);
  const silenceMs = DIGIT_LENGTH[type] ? 1500 : 900;

  for (let attempt = 0; attempt < 3; attempt++) {
    statusEl.textContent = LANG === "hi-IN" ? "बोल रहा हूँ..." : "Speaking...";

    const question = fieldQuestion(label);
    const repeatPrompt = LANG === "hi-IN"
      ? "कृपया फिर से बताइए।"
      : `${label}, again`;

    await speak(attempt === 0 ? question : repeatPrompt);

    statusEl.textContent = LANG === "hi-IN" ? "सुन रहा हूँ..." : "Listening...";

    let heard;

    try {
      heard = await listen(LANG, silenceMs);
    } catch {
      continue;
    }

    heardEl.textContent = `${LANG === "hi-IN" ? "आपने कहा" : "You said"}: ${heard}`;

    if (BACK_CMD.test(heard.trim())) return BACK;
    if (SKIP.test(heard.trim())) return null;

    const { value, error } = cleanAnswer(label, heard);

    if (error) {
      heardEl.textContent = error;
      await speak(error);
      continue;
    }

    heardEl.textContent = `${LANG === "hi-IN" ? "सेव किया" : "Saved"}: ${value}`;

    if (!confirm) return value;

    const spokenValue = DIGIT_LENGTH[type]
      ? value.split("").join(" ")
      : value;

    await speak(confirmationText(spokenValue));
    statusEl.textContent = LANG === "hi-IN"
      ? "हाँ या नहीं कहें।"
      : "Say yes or no...";

    try {
      const reply = await listen(LANG, 700);

      if (YES.test(reply)) return value;
      if (BACK_CMD.test(reply.trim())) return BACK;
    } catch {
      // Ask again if the reply was not recognized.
    }
  }

  return null;
}

async function fillAll(answers) {
  const values = answers.map(({ id, value }) => ({ id, value }));
  return sendToPage({ action: "fillFields", values });
}

function renderReview(answers) {
  reviewRows.innerHTML = "";

  answers.forEach((answer) => {
    const row = document.createElement("div");
    row.className = "row";

    const label = document.createElement("label");
    label.textContent = answer.label;

    const input = document.createElement("input");
    input.value = answer.value;
    input.addEventListener("input", () => {
      answer.value = input.value;
    });

    row.append(label, input);
    reviewRows.appendChild(row);
  });

  reviewEl.style.display = "block";
}

$("refillBtn").addEventListener("click", async () => {
  try {
    const result = await fillAll(currentAnswers);
    statusEl.textContent = `Filled ${result.count} of ${result.total} fields`;
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  }
});

$("doneBtn").addEventListener("click", () => window.close());

startBtn.addEventListener("click", async () => {
  if (!requireLanguage()) return;

  startBtn.disabled = true;
  reviewEl.style.display = "none";
  heardEl.textContent = "";

  const confirm = $("confirmOpt").checked;

  try {
    statusEl.textContent = LANG === "hi-IN"
      ? "माइक्रोफ़ोन जाँच रहा हूँ..."
      : "Checking microphone...";

    await ensureMic();

    const result = await sendToPage({ action: "scan" });
    const fields = result.fields || [];

    if (!fields.length) {
      statusEl.textContent = LANG === "hi-IN"
        ? "इस पेज पर भरने के लिए कोई टेक्स्ट फ़ील्ड नहीं मिला। पेज रीफ़्रेश करके फिर कोशिश करें।"
        : "No fields found on that page. Refresh it and try again.";
      return;
    }

    const answers = new Map();
    let index = 0;

    while (index < fields.length) {
      const field = fields[index];

      progressEl.textContent = LANG === "hi-IN"
        ? `फ़ील्ड ${index + 1} / ${fields.length}`
        : `Field ${index + 1} of ${fields.length}`;

      questionEl.textContent = field.label;
      heardEl.textContent = "";

      sendToPage({ action: "focus", id: field.id }).catch(() => {});

      const answer = await askField(field.label, confirm);

      if (answer === BACK) {
        if (index === 0) {
          await speak(LANG === "hi-IN" ? "यह पहला फ़ील्ड है।" : "This is the first field.");
        } else {
          index--;
          answers.delete(fields[index].id);
        }
        continue;
      }

      if (answer) {
        answers.set(field.id, {
          id: field.id,
          label: field.label,
          value: answer
        });
      }

      index++;
    }

    progressEl.textContent = "";
    questionEl.textContent = LANG === "hi-IN" ? "सभी सवाल पूरे हुए" : "All questions done";
    heardEl.textContent = "";

    const answerList = [...answers.values()];

    if (!answerList.length) {
      statusEl.textContent = LANG === "hi-IN"
        ? "कोई जवाब नहीं मिला।"
        : "No answers were captured.";
      return;
    }

    currentAnswers = answerList;

    const fillResult = await fillAll(answerList);
    renderReview(answerList);

    statusEl.textContent = `Filled ${fillResult.count} of ${fillResult.total} fields`;

    await speak(
      fillResult.count === fillResult.total
        ? (LANG === "hi-IN" ? "हो गया। फ़ॉर्म भर दिया गया है।" : "Done. Your form is filled.")
        : (LANG === "hi-IN" ? "कुछ फ़ील्ड नहीं भर पाए। कृपया फ़ॉर्म जाँचें।" : "Some fields could not be filled. Please check the form.")
    );
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  } finally {
    startBtn.disabled = false;
  }
});

function speakAt(text, rate = 1.0, lang = LANG) {
  return new Promise((resolve) => {
    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = rate;

    const voice = pickVoice(lang);
    if (voice) utterance.voice = voice;

    utterance.onend = resolve;
    utterance.onerror = resolve;
    speechSynthesis.speak(utterance);
  });
}

function plural(count, singular, hindiPlural) {
  if (LANG === "hi-IN") {
    return `${count} ${hindiPlural || singular}`;
  }

  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function spokenFormField(field, index) {
  if (LANG !== "hi-IN") {
    let sentence = `Field ${index + 1}: ${field.label}.`;
    if (field.required) sentence += " Required.";
    if (field.kind !== "text") sentence += ` This is a ${field.kind} field.`;
    return sentence;
  }

  const label = hindiFieldLabel(field.label);
  let sentence = `फ़ील्ड ${index + 1}: ${label}।`;

  if (field.required) sentence += " यह ज़रूरी है।";
  if (field.kind !== "text") {
    sentence += ` फ़ील्ड का प्रकार ${field.kind} है।`;
  }

  return sentence;
}

async function readFormAloud() {
  if (reading) {
    reading = false;
    speechSynthesis.cancel();
    return;
  }

  if (!requireLanguage()) return;

  reading = true;
  readBtn.textContent = LANG === "hi-IN" ? "पढ़ना रोकें" : "Stop reading";
  startBtn.disabled = true;
  reviewEl.style.display = "none";
  heardEl.textContent = "";

  try {
    statusEl.textContent = LANG === "hi-IN"
      ? "पेज देख रहा हूँ..."
      : "Looking at the page...";

    const page = await sendToPage({ action: "describe" });

    const say = async (text, labelForScreen) => {
      if (!reading) return false;
      if (labelForScreen) questionEl.textContent = labelForScreen;
      await speakAt(text, 1.0);
      return reading;
    };

    questionEl.textContent = page.title || "This page";
    progressEl.textContent = LANG === "hi-IN" ? "पेज पढ़ रहा हूँ" : "Reading the page";
    statusEl.textContent = LANG === "hi-IN" ? "आवाज़ में पढ़ रहा हूँ..." : "Reading aloud...";

    if (page.title) {
      const titleText = LANG === "hi-IN"
        ? `इस पेज का नाम है: ${page.title}.`
        : `This page is called ${page.title}.`;

      if (!(await say(titleText))) return;
    }

    if (page.headings.length) {
      const headingText = LANG === "hi-IN"
        ? `मुख्य शीर्षक: ${page.headings[0]}.`
        : `Main heading: ${page.headings[0]}.`;

      if (!(await say(headingText))) return;
    }

    if (!page.fields.length) {
      const noFieldsText = LANG === "hi-IN"
        ? "मुझे भरने के लिए कोई टेक्स्ट फ़ील्ड नहीं मिला।"
        : "I could not find any text boxes on this page.";

      await say(noFieldsText);
      return;
    }

    const countText = LANG === "hi-IN"
      ? `भरने के लिए ${page.fields.length} फ़ील्ड हैं।`
      : `There are ${plural(page.fields.length, "field")} to fill.`;

    if (!(await say(countText))) return;

    for (let index = 0; index < page.fields.length; index++) {
      const field = page.fields[index];

      progressEl.textContent = LANG === "hi-IN"
        ? `फ़ील्ड ${index + 1} / ${page.fields.length}`
        : `Field ${index + 1} of ${page.fields.length}`;

      heardEl.textContent = field.kind === "text"
        ? ""
        : `${LANG === "hi-IN" ? "प्रकार" : "Type"}: ${field.kind}`;

      sendToPage({ action: "focusRead", readId: field.readId }).catch(() => {});

      if (!(await say(spokenFormField(field, index), field.label))) return;
    }

    const otherItems = page.others;
    const hasOtherItems =
      otherItems.dropdowns || otherItems.checkboxes || otherItems.radioGroups;

    if (hasOtherItems) {
      const otherText = LANG === "hi-IN"
        ? "इस पेज पर ड्रॉपडाउन, चेकबॉक्स या विकल्प भी हैं। इस संस्करण में उन्हें अपने हाथ से भरें।"
        : "The page also has dropdowns, checkboxes, or multiple choice questions. Please complete those by hand.";

      if (!(await say(otherText, LANG === "hi-IN" ? "अन्य फ़ील्ड" : "Other items"))) return;
    }

    const doneText = LANG === "hi-IN"
      ? "पढ़ना पूरा हुआ। आवाज़ से फ़ॉर्म भरने के लिए Start दबाएँ।"
      : "That is everything. Press Start to fill the form by voice.";

    await say(doneText, LANG === "hi-IN" ? "पढ़ना पूरा हुआ" : "Done reading");
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  } finally {
    reading = false;
    speechSynthesis.cancel();
    sendToPage({ action: "clearRead" }).catch(() => {});
    readBtn.textContent = "Read form aloud";
    startBtn.disabled = false;

    if (!statusEl.textContent.startsWith("Error")) {
      statusEl.textContent = "Press Start to fill by voice";
    }

    progressEl.textContent = "";
  }
}

readBtn.addEventListener("click", readFormAloud);