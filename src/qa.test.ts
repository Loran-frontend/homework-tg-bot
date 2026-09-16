import assert from "node:assert/strict";
import test from "node:test";
import { parseDeadline, parseEditCommand, parseId } from "./bot.js";
import { formatHomework } from "./format.js";
import type { TopicHomework } from "./types.js";

const makeTopic = (items: TopicHomework["items"] = []): TopicHomework => ({
  chatId: -100123,
  threadId: 1,
  type: "IRNITU",
  items,
});

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

test("deadline parser accepts valid dates and rejects invalid dates", () => {
  const deadline = parseDeadline("31.12.2026 23:59");
  assert.ok(deadline instanceof Date);
  assert.equal(deadline?.toISOString(), "2026-12-31T23:59:00.000Z");
  assert.equal(parseDeadline("31.02.2026 12:00"), null);
  assert.equal(parseDeadline("01.01.2026 25:00"), null);
  assert.equal(parseDeadline("2026-12-31 23:59"), null);
});

test("homework text is safely formatted as HTML", () => {
  const text = formatHomework(makeTopic([{
    id: 1,
    type: "IRNITU",
    subject: "Вычислительная математика",
    description: "<script>alert('x')</script> & dangerous",
    subgroup: "ALL",
    deadline: null,
    archived: false,
    completed: false,
    authorId: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
  }]));

  assert.match(text, /&lt;script&gt;/);
  assert.match(text, /&amp; dangerous/);
  assert.ok(!text.includes("<script>"));
});

test("empty topic produces a valid primary-message body", () => {
  const text = formatHomework(makeTopic());
  assert.match(text, /ДЗ ИРНИТУ/);
  assert.match(text, /Нет заданий/);
});

test("large topic stays within Telegram's 4096-character message limit", () => {
  const text = formatHomework(makeTopic(Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    type: "IRNITU" as const,
    subject: "Вычислительная математика",
    description: "Очень длинное задание ".repeat(30),
    subgroup: "ALL" as const,
    deadline: null,
    archived: false,
    completed: false,
    authorId: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  }))));

  assert.ok(text.length <= 4096);
  assert.match(text, /скрыто/);
});
