document.getElementById("voiceBtn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.windows.create({
    url: `voice.html?tabId=${tab.id}`,
    type: "popup",
    width: 380,
    height: 480,
  });
  window.close();
});

document.getElementById("screenBtn").addEventListener("click", () => {
  // Must open as a tab (not a popup window) so getDisplayMedia works in Chrome MV3
  chrome.tabs.create({ url: chrome.runtime.getURL("screen.html") });
  window.close();
});

document.getElementById("screenBtn").addEventListener("click", () => {
  // Must open as a tab (not a popup window) so getDisplayMedia works in Chrome MV3
  chrome.tabs.create({ url: chrome.runtime.getURL("screen.html") });
  window.close();
});
