# ConvoPort — v0.1 Spec

Chrome MV3 extension that snapshots the Claude.ai conversation you have open and
forks it into ChatGPT, Gemini, or DeepSeek.

Tally's usage bar, remaining-message estimate, licensing and billing are **not**
part of this product. ConvoPort exists for one reason: when Claude runs out of
budget mid-conversation, you keep the context instead of retyping it.

---

## What it does

| Feature | Behaviour |
|---|---|
| **Snapshot** | On every Claude chat page, the full conversation is fetched from Claude's own API and cached as Markdown in `chrome.storage.local`. No button press needed, no polling, no quota calls. |
| **Fork** | Popup → pick a destination → the cached Markdown plus a continuation instruction is pasted into that site's composer in a new tab and Enter is pressed. |
| **Copy as Text** | Popup → copies the same Markdown to the clipboard. |
| **Rate-limit nudge** | When Claude's limit banner appears, a small card in the corner offers ChatGPT / Gemini / DeepSeek, and the popup shows a "fork now" notice with a dismiss ×. Both disappear when the banner leaves the page, so a lifted limit stops nagging. Detection only; nothing forks without a click. |

## What it deliberately does not do

- No overlay/sidebar widget on Claude. The popup is the entire UI; a shadow-DOM
  panel would cost hundreds of lines to fight Claude's SPA re-renders.
- The service worker does one job: wipe the cached conversation at browser
  start. It does not poll, schedule alarms, or hold state.
- No toolbar badge. The rate-limit notice lives in the popup instead.
- No usage/quota polling, no estimates, no billing, no analytics, no remote code.

---

## Architecture

Plain JS, no build step, no dependencies, no bundler.

```
manifest.json
background.js            clears the cache once per browser start
lib/destinations.js      one table of fork targets, shared by popup + page
lib/markdown.js          conversation JSON -> Markdown, shared by content script + tests
content/claude.js        cache the open conversation, rate-limit pill
content/destination.js   paste the pending fork and press Enter
popup/popup.html|js|css  title, message count, four buttons
tests/markdown.test.mjs  node --test
```

Two independent paths meet in `chrome.storage.local`:

```
claude.ai  --(fetch, debounced)-->  snapshot  --(popup read)-->  clipboard
                                                        |
                                                        +--> pending --> destination tab
```

There is no message passing between scripts: both sides only read and write the
same storage keys.

---

## Claude API contract

Same-origin fetches with the user's session cookies, no tokens stored.

| Call | Purpose |
|---|---|
| `GET /api/organizations` | Resolve the org id. Cached in storage for 10 minutes. |
| `GET /api/organizations/{org}/chat_conversations/{id}?tree=True&rendering_mode=raw&render_all_tools=true` | Full conversation. |

Conversation shape used: `name`, `chat_messages[]` with `uuid`,
`parent_message_uuid`, `sender` (`human` / `assistant`), `text`, `content[]`
(`{type:"text"}`), `attachments[]` (`{file_name}`).

`chat_messages` contains every branch of an edited conversation, so the exporter
walks from the newest leaf back through `parent_message_uuid` and reverses. Text
blocks are preferred over `text` to avoid double-counting the same string.
Artifact bodies (`tool_use.input.content`) are included as fenced blocks, last
version per title; thinking and other tool payloads are dropped. If a response
has no parent links at all, messages are exported in `created_at` order instead
of collapsing to one. Every export ends with a short continuation instruction so
the destination model picks up the thread instead of waiting for a new prompt.

---

## Storage contract

All keys are owned by this extension only.

| Key | Shape | Written by | Cleared by |
|---|---|---|---|
| `snapshot` | `{convId, title, markdown, messageCount, updatedAt}` | `content/claude.js`, visible tab only | popup "Clear", or browser start |
| `org` | `{id, at}` | `content/claude.js` | 10-minute TTL check, or a 404 retry |
| `pending` | `{markdown, host, at}` | popup | destination script after injecting, or 2-minute TTL check |
| `rateLimited` | `{at}` | `content/claude.js` | `content/claude.js` once the banner leaves; browser start; popup hides it after 5 h |

Only one conversation is ever stored — a new capture overwrites the old one.
Nothing is kept across browser restarts.

`pending.host` is the guard that stops a fork meant for ChatGPT from being
injected into Gemini: the destination script compares it to `location.hostname`.

## Fork flow

1. Popup reads `snapshot`.
2. Writes `pending = {markdown, host, at: Date.now()}`.
3. `chrome.tabs.create({url})` — no `tabs` permission required for that call.
4. Page loads → `content/destination.js` sees `pending` with a matching host and
   age < 2 min → waits for the composer → inserts → deletes `pending` only if it
   still holds the fork it pasted → presses Enter once the text has settled.
5. If no composer appears within 20 s, a one-line notice is shown on the page and
   `pending` stays in place. A reload retries; the TTL prevents stale injection
   later. If Enter is ignored by a redesigned composer, the text stays in place
   for a manual send.

### Composer selectors

Constants at the top of `content/destination.js`; fallback is the first visible
`textarea` or `[contenteditable="true"]`.

| Site | Host | Preferred selector |
|---|---|---|
| ChatGPT | `chatgpt.com` | `#prompt-textarea` |
| Gemini | `gemini.google.com` | `rich-textarea .ql-editor` |
| DeepSeek | `chat.deepseek.com` | `textarea` |

Insertion: for contenteditable, focus + `document.execCommand("insertText")`
(the only reliable path through ProseMirror/Quill); for `textarea`, the native
value setter plus an `input` event so React picks the text up.

---

## Rate-limit banner hook

`content/claude.js` exposes two constants:

```js
const LIMIT_BANNER_SELECTOR = "";               // fill in once Claude shows you one
const LIMIT_TEXT = /(message limit|usage limit|rate limit|resets at)/i;
```

With no selector set, detection scans `[role="alert"]` and
`[data-testid*="limit"]` for a short, visible element matching `LIMIT_TEXT`, then
records `rateLimited.at` (at most one write per minute).
Worst case it false-negatives and the popup stays quiet: harmless, since the
snapshot is already cached. The exact selector will be pasted in after the next
real rate-limit event.

When the banner is gone from a conversation page, the flag and the card are
removed, so a reset limit stops showing the notice. The popup's × clears the
flag immediately, and the popup hides any flag older than 5 hours as a safety
net. A reloaded extension needs one page refresh before its content script can
clear anything.

On detection a card is appended in a closed shadow root (Claude's CSS cannot
reach it, and CSSOM styles cannot be blocked by page CSP). Its destination
buttons store `pending` and `window.open` the site — allowed because the click
is a user gesture, which is why no background worker is required. The card is
dismissable per page load and disappears with the banner.

---

## Edge cases

| Case | Behaviour |
|---|---|
| Not on a conversation (new chat, settings) | No snapshot written; popup shows "Open a Claude chat". |
| Conversation fetch 401/403 | Silent. Cache keeps the last good snapshot; popup still forks it. |
| Conversation fetch 5xx / network | Debounce retries on the next mutation. |
| Streaming reply in progress | Writes are debounced to 1.5 s after mutations stop and throttled to one fetch per 8 s. |
| Very large conversation | Stored as one string; `storage.local` allows ~10 MB. Fork text is pasted whole, so the destination's own input limit applies. |
| Documented folder renamed mid-flight | Nothing to do — no cross-tab state. |
| Popup opened before first fetch | Shows empty state for under a second; reopen if it is slow. |

## Permissions

```json
"permissions": ["storage"]
```

`content_scripts.matches` is what grants page access on the four origins. No
`host_permissions`, `tabs`, `scripting`, `alarms`, or `activeTab`. Clipboard
writes happen from the popup under a user gesture, which needs no permission.

## Privacy

Conversation content goes only to `chrome.storage.local` and into the composer
of the tab you chose. It is deleted at the next browser start and can be removed
sooner with the popup's "Clear cached chat". There are no network calls except
`claude.ai` (same origin, your cookies). No telemetry, no license check, no third
party.

---

## Verification

**Load:** `chrome://extensions` → Developer mode → Load unpacked → `convoport/`.

1. Open a Claude chat with ≥ 3 messages. In the Claude tab's DevTools console,
   pick the ConvoPort context and run `await chrome.storage.local.get('snapshot')`
   — it must hold a matching `messageCount`.
2. Send a message → wait ~2 s → `snapshot.markdown` ends with the new exchange.
3. Edit an earlier message (creates a branch) → snapshot contains only the
   visible branch, not both.
4. Popup → Copy as Text → paste: header, title, alternating User/Assistant.
5. Popup → ChatGPT → new tab opens, composer holds the transcript, `pending`
   is gone from storage.
6. Repeat on Gemini and DeepSeek.
7. Open popup on `claude.ai/new` → empty state, buttons disabled.
8. `node --test tests/` → green (branch linearisation, no duplicated text,
   attachment placeholders, artifact bodies, tree-less fallback).
9. Without waiting for a real limit, paste this in the Claude tab's page console:

   ```js
   const b = document.createElement("div");
   b.setAttribute("role", "alert");
   b.textContent = "Message limit reached. Resets at 5pm.";
   document.body.append(b);
   ```

   Within ~2 s the corner card must appear; ChatGPT on it must open a prefilled
   tab. Now remove the fake banner. Within ~2 s the card must go away and
   `rateLimited` must be gone from storage — this is the "limit reset" case.
10. Open two Claude chats in two tabs, send a message in the second, switch back
    to the first: the popup must show the first (visible) chat, not the second.
11. When a real limit banner appears, set `LIMIT_BANNER_SELECTOR`, reload the
    extension, confirm the card still appears and clears when the banner goes.
12. Popup → "Clear cached chat" → buttons disable and `snapshot` is gone.
13. Quit and reopen Chrome → `snapshot`, `pending` and `rateLimited` are gone;
    opening a Claude chat repopulates `snapshot`.

## Open items

- Exact rate-limit banner selector (user to supply).
- Destination selectors are best-effort against current UIs; they live in one
  constant map for easy repair.
