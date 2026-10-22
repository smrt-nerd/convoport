// The cached conversation lives for one browser session only: start clean.
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.remove(["snapshot", "pending", "rateLimited"]);
});
