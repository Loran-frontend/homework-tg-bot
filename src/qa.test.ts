import assert from "node:assert/strict";
import test from "node:test";
import { parseAddCommand } from "./add-flow.js";
import { parseDeadline, parseEditCommand, parseId, parseOutputDestination } from "./bot.js";
import { formatHomework, formatPersistentMessages } from "./format.js";
import type { HomeworkItem, TopicHomework } from "./types.js";

const makeTopic = (items: TopicHomework["items"] = []): TopicHomework => ({
  chatId: -100123,
  threadId: 1,
  type: "IRNITU",
  items,
});

const makeItem = (subgroup: HomeworkItem["subgroup"], id: number): HomeworkItem => ({
  id,
  type: "IRNITU",
  subject: "Вычислительная математика",
  description: `Задание ${id}`,
  subgroup,
  deadline: null,
  archived: false,
  completed: false,
  authorId: 10,
  createdAt: new Date(),
  updatedAt: new Date(),
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

test("output destination is independent from the command topic", () => {
  const current = { chatId: -100123, threadId: 123 };
  assert.deepEqual(parseOutputDestination("here", current), current);
  assert.deepEqual(parseOutputDestination("-100456 789", current), { chatId: -100456, threadId: 789 });
  assert.deepEqual(parseOutputDestination("-100456:789", current), { chatId: -100456, threadId: 789 });
  assert.deepEqual(parseOutputDestination("here:321", current), { chatId: -100123, threadId: 321 });
  assert.throws(() => parseOutputDestination("-100456", current));
  assert.throws(() => parseOutputDestination("-100456 -1", current));
});

test("direct /add command parser supports legacy text and optional deadline", () => {
  const noDeadline = parseAddCommand("Решить задачи");
  assert.deepEqual(noDeadline, {
    type: "IRNITU",
    subject: "Вычислительная математика",
    subgroup: "ALL",
    description: "Решить задачи",
    deadline: null,
  });

  const parsed = parseAddCommand("Решить задачи | 31.12.2026 23:59");
  assert.equal(parsed?.description, "Решить задачи");
  assert.equal(parsed?.deadline?.toISOString(), "2026-12-31T23:59:00.000Z");
  assert.equal(parseAddCommand("Решить задачи | 31.02.2026 12:00"), null);
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

test("all homework subgroups are displayed without user-subgroup filtering", () => {
  const data = {
    chatId: -100123,
    threadId: 1,
    activeMessageId: undefined,
    activeChatId: undefined,
    archiveMessageId: undefined,
    archiveChatId: undefined,
    active: [{ ...makeTopic([makeItem("GROUP_1", 1), makeItem("GROUP_2", 2), makeItem("ALL", 3)]) }],
    archive: [],
  };

  const text = formatPersistentMessages(data).active;
  assert.match(text, /1 подгруппа/);
  assert.match(text, /2 подгруппа/);
  assert.match(text, /Все/);
  assert.match(text, /Задание 1/);
  assert.match(text, /Задание 2/);
  assert.match(text, /Задание 3/);
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
