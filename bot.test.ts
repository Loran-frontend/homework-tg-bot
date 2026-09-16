import assert from "node:assert/strict";
import test from "node:test";
import { parseDeadline, parseEditCommand, parseId, parseOutputDestination } from "./bot.js";

test("test runner is available", () => {
  assert.equal(true, true);
});

test("parseOutputDestination keeps explicit chat and topic", () => {
  assert.deepEqual(
    parseOutputDestination("-1001234567890 200", { chatId: -1001, threadId: 10 }),
    { chatId: -1001234567890, threadId: 200 },
  );
});

test("parseOutputDestination here uses the command topic only as an explicit destination", () => {
  assert.deepEqual(
    parseOutputDestination("here", { chatId: -1001, threadId: 42 }),
    { chatId: -1001, threadId: 42 },
  );
});

test("parseOutputDestination supports a topic in the current chat", () => {
  assert.deepEqual(
    parseOutputDestination("here:77", { chatId: -1001, threadId: 42 }),
    { chatId: -1001, threadId: 77 },
  );
});

test("parseDeadline validates calendar dates without changing deadline semantics", () => {
  const valid = parseDeadline("20.09.2026 23:59");
  assert.ok(valid);
  assert.equal(valid?.toISOString(), "2026-09-20T23:59:00.000Z");
  assert.equal(parseDeadline("31.02.2026 23:59"), null);
});

test("basic command parsers remain unchanged", () => {
  assert.equal(parseId("42"), 42);
  assert.equal(parseId("0"), null);
  assert.deepEqual(parseEditCommand("42 новый текст"), { id: 42, text: "новый текст" });
});
