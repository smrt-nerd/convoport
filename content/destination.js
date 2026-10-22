// Injects a pending fork into the destination site's composer, then forgets it.
const SELECTORS = {
  "chatgpt.com": "#prompt-textarea",
  "chat.openai.com": "#prompt-textarea",
  "gemini.google.com": 'rich-textarea .ql-editor, rich-textarea [contenteditable="true"]',
  "chat.deepseek.com": "textarea",
};
const TTL_MS = 2 * 60 * 1000;

function visible(el) {
  return !!el && el.getClientRects().length > 0;
}

async function findComposer() {
  const preferred = SELECTORS[location.hostname];
  for (let i = 0; i < 60; i++) {
    // 20s: these apps hydrate their editor after load. A hidden preferred match
    // must not shadow a usable textarea, so test every candidate for visibility.
    const candidates = [
      preferred && document.querySelector(preferred),
      ...document.querySelectorAll('textarea, [contenteditable="true"]'),
    ];
    const el = candidates.find(visible);
    if (el) return el;
    await new Promise((r) => setTimeout(r, 350));
  }
  return null;
}

const squash = (s) => s.replace(/\s+/g, " ").trim();

function typeInto(el, text) {
  el.focus();
  if (el.isContentEditable) {
    // execCommand is the only write path ProseMirror and Quill both honour
    document.execCommand("insertText", false, text);
    // Editors turn newlines into paragraphs, so compare whitespace-blind.
    return squash(el.textContent).includes(squash(text).slice(0, 40));
  }
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setValue.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

// Enter sends in all three apps. The delay lets the editor commit the pasted
// value; if the composer is already empty the user sent it themselves meanwhile.
function pressEnter(el) {
  setTimeout(() => {
    const left = el.isContentEditable ? el.textContent.trim() : el.value.trim();
    if (!left) return;
    el.focus();
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, 300);
}

function showNotice(text) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText =
    "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
    "padding:8px 12px;border-radius:8px;background:#1f1f1f;color:#eee;" +
    "font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px #0004;";
  document.body.append(el);
  setTimeout(() => el.remove(), 12000);
}

(async () => {
  const { pending } = await chrome.storage.local.get("pending");
  if (!pending || pending.host !== location.hostname) return;
  if (typeof pending.markdown !== "string") return chrome.storage.local.remove("pending");
  if (Date.now() - pending.at > TTL_MS) return chrome.storage.local.remove("pending");
  const el = await findComposer();
  if (!el) {
    // A renamed editor must be loud, not silent.
    return showNotice("ConvoPort: input box not found. Your text is saved — reload within 2 minutes to retry.");
  }
  if (!typeInto(el, pending.markdown)) {
    return showNotice("ConvoPort: couldn't paste the text. It is still saved — reload within 2 minutes to retry.");
  }
  // Only clear the fork we actually pasted; a newer one may have replaced it.
  const latest = await chrome.storage.local.get("pending");
  if (latest.pending && latest.pending.at === pending.at) {
    await chrome.storage.local.remove("pending");
  }
  pressEnter(el);
})();
