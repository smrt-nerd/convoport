import test from "node:test";
import assert from "node:assert/strict";

await import("../lib/markdown.js");
const { fromConversation, linearize } = globalThis.CPMarkdown;

const conv = {
  name: "Rate limit escape",
  chat_messages: [
    { uuid: "u1", parent_message_uuid: null, sender: "human", created_at: "2026-01-01T00:00:00Z", text: "first" },
    { uuid: "a1", parent_message_uuid: "u1", sender: "assistant", created_at: "2026-01-01T00:01:00Z", text: "answer one" },
    { uuid: "u2", parent_message_uuid: "a1", sender: "human", created_at: "2026-01-01T00:02:00Z", text: "abandoned branch" },
    {
      uuid: "u2b",
      parent_message_uuid: "a1",
      sender: "human",
      created_at: "2026-01-01T00:03:00Z",
      text: "edited text",
      content: [{ type: "text", text: "edited text" }],
      attachments: [{ file_name: "diagram.png" }],
    },
    {
      uuid: "a2",
      parent_message_uuid: "u2b",
      sender: "assistant",
      created_at: "2026-01-01T00:04:00Z",
      content: [
        { type: "thinking", thinking: "secret" },
        { type: "text", text: "answer two" },
        { type: "tool_use", name: "artifacts", input: { title: "chart.js", command: "create", content: "const first = 1;" } },
        { type: "tool_use", name: "artifacts", input: { title: "chart.js", command: "rewrite", content: "const final = 2;" } },
        { type: "tool_use", name: "web_search", input: { query: "big payload" } },
      ],
    },
  ],
};

test("walks the newest branch, not every branch", () => {
  assert.deepEqual(linearize(conv.chat_messages).map((m) => m.uuid), ["u1", "a1", "u2b", "a2"]);
});

test("renders a transcript without repeated text or internals", () => {
  const out = fromConversation(conv);
  assert.equal(out.messageCount, 4);
  assert.match(out.markdown, /^# Rate limit escape/);
  assert.match(out.markdown, /\*\*User\*\*\n\nedited text/);
  assert.equal((out.markdown.match(/edited text/g) || []).length, 1);
  assert.match(out.markdown, /_\[attached: diagram\.png\]_/);
  assert.doesNotMatch(out.markdown, /abandoned branch|secret|big payload/);
});

test("keeps artifact bodies, last version only", () => {
  const out = fromConversation(conv);
  assert.equal((out.markdown.match(/### Artifact: chart\.js/g) || []).length, 1);
  assert.match(out.markdown, /const final = 2;/);
  assert.doesNotMatch(out.markdown, /const first = 1;/);
});

test("ends with a continuation instruction", () => {
  const out = fromConversation(conv);
  assert.match(out.markdown, /\n---\n\n_This conversation was moved from Claude\.ai\./);
  assert.match(out.markdown, /take the next useful step/);
  assert.match(out.markdown.trimEnd(), /work in progress\._$/);
});

test("exports in order when the API sends no parent links", () => {
  const messages = [
    { uuid: "m1", sender: "human", created_at: "2026-01-01T00:00:00Z", text: "one" },
    { uuid: "m2", sender: "assistant", created_at: "2026-01-01T00:01:00Z", text: "two" },
  ];
  assert.deepEqual(linearize(messages).map((m) => m.uuid), ["m1", "m2"]);
  assert.equal(fromConversation({ chat_messages: messages }).messageCount, 2);
});

test("empty conversations produce nothing", () => {
  assert.equal(fromConversation({ chat_messages: [] }), null);
  assert.equal(fromConversation({}), null);
});
