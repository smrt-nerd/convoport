// Conversation JSON -> portable Markdown.
// Loaded as a plain content script and imported by node tests; no modules.
(function (root) {
  // Appended to every export so a fork lands as a message the target can act on,
  // not just a transcript waiting for a manual prompt.
  const CONTINUE =
    "_This conversation was moved from Claude.ai. " +
    "Continue from where it stopped: use the transcript above as our shared context, " +
    "don't repeat or summarize it, and take the next useful step on the work in progress._";

  // chat_messages holds every edited branch. Walk back from the newest leaf.
  function linearize(messages) {
    if (!Array.isArray(messages) || !messages.length) return [];
    const byId = new Map(messages.filter((m) => m && m.uuid).map((m) => [m.uuid, m]));
    const parentIds = new Set(messages.map((m) => m.parent_message_uuid).filter(Boolean));
    const leaves = messages.filter((m) => m.uuid && !parentIds.has(m.uuid));
    const at = (m) => Date.parse(m.created_at) || 0;
    // No parent links at all means a tree-less response (API change): export
    // in order instead of collapsing to the single newest message.
    if (messages.length > 1 && !messages.some((m) => m && m.parent_message_uuid)) {
      return [...messages].sort((a, b) => at(a) - at(b));
    }
    const leaf = (leaves.length ? leaves : messages).reduce((a, b) => (at(b) >= at(a) ? b : a));
    const chain = [];
    const seen = new Set();
    for (let cur = leaf; cur && !seen.has(cur.uuid); cur = byId.get(cur.parent_message_uuid)) {
      seen.add(cur.uuid);
      chain.push(cur);
    }
    return chain.reverse();
  }

  // Prefer content text blocks; msg.text repeats them and would double up.
  function textOf(message) {
    const blocks = Array.isArray(message.content) ? message.content : [];
    const text = blocks
      .filter((c) => c && c.type === "text" && typeof c.text === "string" && c.text.trim())
      .map((c) => c.text.trim())
      .join("\n\n") || (typeof message.text === "string" ? message.text.trim() : "");
    // Artifacts live in tool_use.input.content, not in text blocks. Keep the
    // last version per title: create/rewrite calls repeat the same artifact.
    const artefacts = new Map();
    for (const c of blocks) {
      const input = c && c.type === "tool_use" && c.input;
      if (input && typeof input.content === "string" && input.content.trim()) {
        artefacts.set(input.title || input.id || "untitled", input.content.trim());
      }
    }
    const bodies = [...artefacts].map(
      ([title, body]) => `### Artifact: ${title}\n\n\`\`\`\`\n${body}\n\`\`\`\``,
    );
    const files = (Array.isArray(message.attachments) ? message.attachments : [])
      .map((a) => a && (a.file_name || a.name))
      .filter(Boolean)
      .map((name) => `_[attached: ${name}]_`);
    return [text, ...bodies, ...files].filter(Boolean).join("\n\n");
  }

  function fromConversation(conv, opts) {
    const chain = linearize(conv && conv.chat_messages);
    const title = (conv && conv.name) || (opts && opts.fallbackTitle) || "Claude conversation";
    const turns = chain.map((m) => ({ sender: m.sender, body: textOf(m) })).filter((t) => t.body);
    if (!turns.length) return null;
    const transcript = turns
      .map((t) => `**${t.sender === "human" ? "User" : "Assistant"}**\n\n${t.body}`)
      .join("\n\n");
    const header =
      `# ${title}\n\n` +
      `_Forked from Claude.ai on ${new Date().toISOString().slice(0, 10)} · ${turns.length} messages_\n\n`;
    return {
      title,
      markdown: `${header}${transcript}\n\n---\n\n${CONTINUE}\n`,
      messageCount: turns.length,
    };
  }

  root.CPMarkdown = { fromConversation, linearize, textOf };
})(globalThis);
