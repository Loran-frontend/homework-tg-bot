import assert from "node:assert/strict";
import test from "node:test";
import { isMissingMessageError, parseEditCommand, parseId } from "./bot.js";
import { formatHomework, TELEGRAM_MESSAGE_LIMIT } from "./format.js";

test("parseId accepts only positive integer ids", () => {
  assert.equal(parseId("1"), 1);
  assert.equal(parseId(" 42 "), 42);
  assert.equal(parseId("0"), null);
  assert.equal(parseId("-1"), null);
  assert.equal(parseId("1.5"), null);
  assert.equal(parseId("abc"), null);
  assert.equal(parseId(""), null);
});

test("parseEditCommand requires id and non-empty text", () => {
  assert.deepEqual(parseEditCommand("1 Математика — решить №1–20"), {
    id: 1,
    text: "Математика — решить №1–20",
  });
  assert.equal(parseEditCommand(""), null);
  assert.equal(parseEditCommand("1"), null);
  assert.equal(parseEditCommand("abc текст"), null);
  assert.equal(parseEditCommand("1    "), null);
});

test("missing Telegram message errors are detected from ApiError description", () => {
  assert.equal(isMissingMessageError({ description: "Bad Request: message to edit not found" }), true);
  assert.equal(isMissingMessageError({ description: "Bad Request: message can't be edited" }), true);
  assert.equal(isMissingMessageError(new Error("Bad Request: message is not modified")), false);
  assert.equal(isMissingMessageError(new Error("network error")), false);
});

test("homework formatter escapes HTML and stays within Telegram message limit", () => {
  const text = formatHomework({
    chatId: 1,
    threadId: 2,
    items: [{
      id: 1,
      text: "<script> & \"опасный\"",
      completed: false,
      authorId: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }],
  });

  assert.match(text, /&lt;script&gt; &amp; &quot;опасный&quot;/);
  assert.ok(text.length <= TELEGRAM_MESSAGE_LIMIT);
});

test("homework formatter does not exceed Telegram limit for a very large list", () => {
  const text = formatHomework({
    chatId: 1,
    threadId: 2,
    items: Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      text: "Очень длинное домашнее задание ".repeat(30),
      completed: false,
      authorId: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  });

  assert.ok(text.length <= TELEGRAM_MESSAGE_LIMIT);
  assert.match(text, /ограничения Telegram/);
});
