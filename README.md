# ConvoPort

Snapshot the Claude.ai conversation you have open and continue it in ChatGPT,
Gemini or DeepSeek — instead of retyping the thread after a rate limit.

Plain JavaScript, Manifest V3, no build step, no dependencies, no server.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. Pin ConvoPort to the toolbar.

Requires a current Chrome or Edge (Manifest V3). No build step, no dependencies.

After reloading or updating the extension, **refresh any open claude.ai tab** —
Chrome keeps the old content script until the page reloads.

## Use

| Action | What happens |
|---|---|
| Open a Claude chat | The conversation is captured automatically, about 1.5 s after the page stops changing. Only the visible Claude tab writes. |
| Toolbar icon | Shows the captured title, message count and age, plus four buttons. |
| **Copy as Text** | Puts the full export (transcript plus the continuation line) on the clipboard. |
| **ChatGPT / Gemini / DeepSeek** | Opens that site in a new tab, pastes the transcript plus a continuation instruction, and presses Enter. |
| **Clear cached chat** | Deletes the stored copy. It comes back if you keep using Claude. |

A fork is valid for **2 minutes** and only for the site it was made for. The
pasted text ends with a short instruction telling the new model to continue the
conversation, and the extension presses Enter for you.
If the destination changes its input box or send key, a notice appears on that
page (or the text stays in the box for a manual send) instead of failing silently;
reload within 2 minutes to retry.

## Rate-limit card

When Claude's own limit banner appears, a card in the bottom-right corner offers
the three destinations, and the popup shows a notice. The card and the notice go
away on their own when the banner leaves the page. Both can be dismissed by hand
(× in the popup, × on the card).

Detection falls back to `[role="alert"]` and `[data-testid*="limit"]` elements.
To pin Claude's exact banner, put its CSS selector in `LIMIT_BANNER_SELECTOR` at
the top of `content/claude.js` and reload the extension.

## What is stored

One conversation, never a history: `snapshot` is overwritten on each capture.
`pending` holds an un-injected fork for at most 2 minutes.

All of it lives in `chrome.storage.local` and is deleted at the next browser
start, or immediately with **Clear cached chat**. Nothing is uploaded anywhere;
the only network calls are to `claude.ai`, same origin, with your cookies.

## Limits

- One conversation cached at a time.
- Text only: attached files are named, not uploaded. Artifacts are included as
  fenced code blocks, last version per title.
- Very large chats are pasted whole; the destination's own input limit applies.
- Destination selectors (`content/destination.js`) are best-effort and may need
  a one-line update when those sites redesign.

## Development

```sh
node --test tests/        # exporter: branches, artifacts, attachments, fallbacks
```

Layout:

```
manifest.json
background.js            clears the cache once per browser start
lib/destinations.js      shared fork targets (popup + in-page card)
lib/markdown.js          conversation JSON -> Markdown
content/claude.js        capture loop, rate-limit detection + card
content/destination.js   pastes a pending fork into the target composer, then sends it
popup/                   the whole UI
tests/                   node:test, no dependencies
SPEC.md                  design and behavior reference
```

## Troubleshooting

- **Popup says "Open a Claude chat"** — no capture yet. Open a conversation and
  give it a second; after a browser restart the cache starts empty by design.
- **Title/message count looks old** — the Claude tab is running an old content
  script or has not changed. Refresh the tab.
- **Fork tab is empty** — check the page for a ConvoPort notice; the input box
  selector probably changed. The fork is kept for 2 minutes.
- **Fork text is in the box but unsent** — the site ignored the synthetic Enter.
  Press send once; the next fork usually works after a reload.
- **Rate-limit notice will not go away** — refresh the Claude tab, or click the
  × on the notice. The extension can only re-check the banner when a Claude page
  is loaded.

## License

MIT © 2026 Abdullah Rafid. See [LICENSE](LICENSE).
