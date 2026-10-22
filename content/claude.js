// Keeps `snapshot` in chrome.storage.local equal to the conversation on screen.
// Paste Claude's limit-banner selector here once you have seen one; empty means
// fall back to text matching.
const LIMIT_BANNER_SELECTOR = "";
const LIMIT_TEXT = /(message limit|usage limit|rate limit|resets at)/i;
const SETTLE_MS = 1500; // mutations must stop this long (streaming) before a fetch
const MIN_GAP_MS = 8000; // never refetch the whole conversation more often than this

let timer = null;
let lastFetchAt = 0;
let lastLimitAt = 0;
let limitState = null; // null = unknown, "limited", "clear"
let pillDismissed = false;

const PILL_DEST = globalThis.CP_DEST; // shared with the popup; loaded before this file

function conversationId() {
  const m = location.pathname.match(/\/chat\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

async function orgId() {
  const { org } = await chrome.storage.local.get("org");
  if (org && Date.now() - org.at < 10 * 60 * 1000) return org.id;
  const r = await fetch("/api/organizations", { credentials: "include" });
  if (!r.ok) throw new Error(`organizations ${r.status}`);
  const list = await r.json();
  const id = (Array.isArray(list) ? list : []).map((o) => o && o.uuid).find(Boolean);
  if (!id) throw new Error("no organization");
  await chrome.storage.local.set({ org: { id, at: Date.now() } });
  return id;
}

async function refresh() {
  const gap = MIN_GAP_MS - (Date.now() - lastFetchAt);
  if (gap > 0) {
    clearTimeout(timer);
    timer = setTimeout(refresh, gap);
    return;
  }
  const convId = conversationId();
  if (!convId || !globalThis.CPMarkdown) return;
  lastFetchAt = Date.now();
  const url = (org) =>
    `/api/organizations/${org}/chat_conversations/${convId}?tree=True&rendering_mode=raw&render_all_tools=true`;
  try {
    let r = await fetch(url(await orgId()), { credentials: "include" });
    if (r.status === 404) {
      // Cached org is stale after switching orgs: resolve once more.
      await chrome.storage.local.remove("org");
      r = await fetch(url(await orgId()), { credentials: "include" });
    }
    if (!r.ok) return;
    const snap = globalThis.CPMarkdown.fromConversation(await r.json(), {
      fallbackTitle: document.title.replace(/\s*[-·]\s*Claude.*$/i, ""),
    });
    if (!snap) return;
    // Every tab shares one snapshot key, so only the visible one may publish,
    // and only if the page is still on the conversation we fetched.
    if (conversationId() !== convId || document.visibilityState !== "visible") return;
    await chrome.storage.local.set({
      snapshot: { convId, ...snap, updatedAt: Date.now() },
    });
  } catch {
    // next mutation retries; a failed fetch must never break the page
  }
}

// Shows up exactly when Claude stops answering, so no toolbar hunting.
// Styles are set through CSSOM: page CSP cannot block them, and a shadow root
// keeps Claude's CSS off the widget.
function showPill() {
  if (pillDismissed || !conversationId() || document.getElementById("convoport-pill")) return;
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const host = document.createElement("div");
  host.id = "convoport-pill";
  const root = host.attachShadow({ mode: "closed" });

  const box = document.createElement("div");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "ConvoPort");
  box.style.cssText =
    "position:fixed;right:18px;bottom:18px;z-index:2147483647;width:236px;padding:12px 14px;" +
    `border-radius:12px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 28px #0003;border:1px solid ${dark ? "#fff2" : "#0002"};` +
    `background:${dark ? "#1f1f1f" : "#fff"};color:${dark ? "#eee" : "#111"};`;

  const text = document.createElement("p");
  text.textContent = "Claude's limit hit. Keep this conversation going elsewhere?";
  text.style.cssText = "margin:0 0 10px;padding-right:14px;font:inherit;";

  const close = document.createElement("button");
  close.textContent = "×";
  close.setAttribute("aria-label", "Dismiss");
  close.style.cssText =
    "position:absolute;top:6px;right:8px;border:0;background:none;cursor:pointer;font-size:16px;line-height:1;" +
    `color:${dark ? "#aaa" : "#666"};`;
  close.addEventListener("click", () => {
    pillDismissed = true;
    host.remove();
  });

  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:6px;";
  for (const dest of Object.values(PILL_DEST)) {
    const button = document.createElement("button");
    button.textContent = dest.label;
    button.style.cssText =
      "flex:1;font:inherit;padding:6px 4px;border-radius:7px;cursor:pointer;" +
      `border:1px solid ${dark ? "#fff2" : "#0002"};background:${dark ? "#2e2e2e" : "#f2f2f2"};color:${dark ? "#eee" : "#111"};`;
    button.addEventListener("click", async () => {
      try {
        const { snapshot } = await chrome.storage.local.get("snapshot");
        if (!snapshot) {
          text.textContent = "No snapshot captured yet.";
          return;
        }
        await chrome.storage.local.set({
          pending: { markdown: snapshot.markdown, host: dest.host, at: Date.now() },
        });
        window.open(dest.url, "_blank", "noopener"); // click gesture, so not popup-blocked
      } catch {
        text.textContent = "Extension was reloaded — refresh this page.";
      }
    });
    row.append(button);
  }

  box.append(close, text, row);
  root.append(box);
  document.body.append(host);
}

function findLimitBanner() {
  if (LIMIT_BANNER_SELECTOR) return document.querySelector(LIMIT_BANNER_SELECTOR);
  return [...document.querySelectorAll('[role="alert"], [data-testid*="limit"]')].find(
    (e) =>
      e.getClientRects().length > 0 &&
      e.textContent.length < 400 &&
      LIMIT_TEXT.test(e.textContent),
  );
}

function syncLimit() {
  const banner = findLimitBanner();
  if (!banner) {
    if (limitState === "clear" || !conversationId()) return;
    // Banner left the page (limit reset, navigation, reload): drop the flag
    // and the card, so the popup stops claiming a limit that is gone.
    limitState = "clear";
    lastLimitAt = 0;
    pillDismissed = false;
    document.getElementById("convoport-pill")?.remove();
    chrome.storage.local.remove("rateLimited").catch(() => {});
    return;
  }
  if (limitState === "limited" || Date.now() - lastLimitAt < 60 * 1000) return;
  limitState = "limited";
  lastLimitAt = Date.now();
  chrome.storage.local.set({ rateLimited: { at: lastLimitAt } }).catch(() => {});
  showPill();
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    refresh();
    syncLimit();
  }, SETTLE_MS);
}

new MutationObserver(schedule).observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
});

// A tab that becomes visible owns the shared snapshot key; refresh right away
// instead of waiting for the 8 s gap.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  lastFetchAt = 0;
  schedule();
});

schedule();
