import assert from "node:assert/strict";
import test from "node:test";
import { parseEditCommand, parseId } from "./bot.js";
import { formatHomework } from "./format.js";

test("command argument edge cases", () => {
  assert.equal(parseId(""), null);
  assert.equal(parseId("-1"), null);
  assert.equal(parseId("0"), null);
  assert.equal(parseId("1.5"), null);
  assert.equal(parseId("abc"), null);
  assert.equal(parseId("1"), 1);
  assert.deepEqual(parseEditCommand("1 Математика — решить №1–10"), {
    id: 1,
    text: "Математика — решить №1–10",
  });
  assert.equal(parseEditCommand(""), null);
  assert.equal(parseEditCommand("1"), null);
  assert.equal(parseEditCommand("-1 текст"), null);
  assert.equal(parseEditCommand("abc текст"), null);
});

test("large and hostile homework text is safely formatted as HTML", () => {
  const text = formatHomework({
    chatId: -100123,
    threadId: 42,
    items: [{
      id: 1,
      text: "<script>alert('x')</script> & dangerous",
      completed: false,
      authorId: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    }],
  });

  assert.match(text, /&lt;script&gt;/);
  assert.match(text, /&amp; dangerous/);
  assert.ok(!text.includes("<script>"));
});

test("empty topic produces a valid primary-message body", () => {
  const text = formatHomework({ chatId: -100123, threadId: 1, items: [] });
  assert.match(text, /Домашние задания/);
  assert.match(text, /Пока домашних заданий нет/);
});

test("large topic stays within Telegram's 4096-character message limit", () => {
  const text = formatHomework({
    chatId: -100123,
    threadId: 99,
    items: Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      text: "Очень длинное задание ".repeat(30),
      completed: false,
      authorId: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  });

  assert.ok(text.length <= 4096);
  assert.match(text, /скрыто/);
});
