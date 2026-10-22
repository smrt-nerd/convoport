const DESTINATIONS = globalThis.CP_DEST; // shared with the in-page card
const NOTICE_TTL_MS = 5 * 60 * 60 * 1000; // safety cap; Claude's content script clears it sooner
const STALE_FORK_MS = 2 * 60 * 1000;

const meta = document.getElementById("meta");
const status = document.getElementById("status");
const notice = document.getElementById("notice");
const clearButton = document.getElementById("clear");
const buttons = [...document.querySelectorAll("button[data-dest]")];
let snapshot = null;

function showLimitNotice(flag) {
  notice.hidden = !(flag && Date.now() - flag.at < NOTICE_TTL_MS);
}

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  return s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
}

function render() {
  buttons.forEach((b) => (b.disabled = !snapshot));
  clearButton.hidden = !snapshot;
  meta.textContent = snapshot
    ? `${snapshot.title} · ${snapshot.messageCount} messages · ${ago(snapshot.updatedAt)}`
    : "Open a Claude chat to capture it.";
}

async function copy() {
  await navigator.clipboard.writeText(snapshot.markdown);
  status.textContent = "Copied to clipboard.";
}

async function fork(name) {
  const dest = DESTINATIONS[name];
  await chrome.storage.local.set({
    pending: { markdown: snapshot.markdown, host: dest.host, at: Date.now() },
  });
  await chrome.tabs.create({ url: dest.url });
  window.close();
}

async function init() {
  const stored = await chrome.storage.local.get(["snapshot", "rateLimited", "pending"]);
  snapshot = stored.snapshot || null;
  showLimitNotice(stored.rateLimited);
  if (stored.pending && Date.now() - stored.pending.at > STALE_FORK_MS) {
    await chrome.storage.local.remove("pending");
  }
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.snapshot) {
    snapshot = changes.snapshot.newValue || null;
    render();
  }
  if (changes.rateLimited) showLimitNotice(changes.rateLimited.newValue);
});

document.addEventListener("click", async (e) => {
  const button = e.target.closest("button[data-dest]");
  if (!button || !snapshot) return;
  try {
    if (button.dataset.dest === "copy") await copy();
    else await fork(button.dataset.dest);
  } catch (err) {
    status.textContent = String((err && err.message) || err);
  }
});

document.getElementById("dismissNotice").addEventListener("click", () => {
  chrome.storage.local.remove("rateLimited");
  notice.hidden = true;
});

clearButton.addEventListener("click", async () => {
  await chrome.storage.local.remove("snapshot");
  snapshot = null;
  render();
  status.textContent = "Cached chat cleared.";
});

init();
setInterval(render, 30 * 1000); // keep the "ago" label honest while open
