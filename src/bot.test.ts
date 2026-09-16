import assert from "node:assert/strict";
import test from "node:test";
import { isMissingMessageError, parseDeadline, parseEditCommand, parseId } from "./bot.js";
import { formatHomework, IRNITU_SUBJECTS, MIPT_SUBJECTS, TELEGRAM_MESSAGE_LIMIT, isValidSubject } from "./format.js";

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
  assert.deepEqual(parseEditCommand("1 Математика — решить №1–20"), { id: 1, text: "Математика — решить №1–20" });
  assert.equal(parseEditCommand(""), null);
  assert.equal(parseEditCommand("1"), null);
  assert.equal(parseEditCommand("abc текст"), null);
  assert.equal(parseEditCommand("1    "), null);
});

test("parseDeadline accepts the required future format", () => {
  const deadline = parseDeadline("25.09.2026 23:59");
  assert.ok(deadline instanceof Date);
  assert.equal(deadline?.getFullYear(), 2026);
  assert.equal(deadline?.getMonth(), 8);
  assert.equal(deadline?.getDate(), 25);
  assert.equal(parseDeadline("31.02.2026 23:59"), null);
  assert.equal(parseDeadline("25/09/2026 23:59"), null);
});

test("subject catalog is separated by homework type", () => {
  assert.ok(isValidSubject("IRNITU", IRNITU_SUBJECTS[0]));
  assert.ok(isValidSubject("MIPT", MIPT_SUBJECTS[0]));
  assert.equal(isValidSubject("IRNITU", MIPT_SUBJECTS[0]), false);
  assert.equal(isValidSubject("MIPT", IRNITU_SUBJECTS[0]), false);
});

test("missing Telegram message errors are detected from ApiError description", () => {
  assert.equal(isMissingMessageError({ description: "Bad Request: message to edit not found" }), true);
  assert.equal(isMissingMessageError({ description: "Bad Request: message can't be edited" }), true);
  assert.equal(isMissingMessageError(new Error("Bad Request: message is not modified")), false);
  assert.equal(isMissingMessageError(new Error("network error")), false);
});

test("IRNITU formatter contains subject, subgroup and deadline", () => {
  const text = formatHomework({ chatId: 1, threadId: 2, type: "IRNITU", items: [{ id: 1, type: "IRNITU", subject: "Вычислительная математика", description: "Решить задачи 1–10", subgroup: "GROUP_1", deadline: new Date(2026, 8, 25, 23, 59), archived: false, completed: false, authorId: 1, createdAt: new Date(), updatedAt: new Date() }] });
  assert.match(text, /ДЗ ИРНИТУ/);
  assert.match(text, /Вычислительная математика/);
  assert.match(text, /1 подгруппа/);
  assert.match(text, /25\.09\.2026 23:59/);
});

test("MIPT formatter never includes IRNITU items", () => {
  const text = formatHomework({ chatId: 1, threadId: 2, type: "MIPT", items: [{ id: 2, type: "MIPT", subject: "Программирование на языке Python", description: "Лабораторная работа №2", subgroup: "GROUP_2", deadline: new Date(2026, 8, 27, 23, 59), archived: false, completed: false, authorId: 1, createdAt: new Date(), updatedAt: new Date() }] });
  assert.match(text, /ДЗ МФТИ/);
  assert.match(text, /Программирование на языке Python/);
  assert.doesNotMatch(text, /Вычислительная математика/);
});

test("homework formatter escapes HTML and stays within Telegram message limit", () => {
  const text = formatHomework({ chatId: 1, threadId: 2, type: "IRNITU", items: [{ id: 1, type: "IRNITU", subject: "Вычислительная математика", description: "<script> & \"опасный\"", subgroup: "ALL", deadline: null, archived: false, completed: false, authorId: 1, createdAt: new Date(), updatedAt: new Date() }] });
  assert.match(text, /&lt;script&gt; &amp; &quot;опасный&quot;/);
  assert.ok(text.length <= TELEGRAM_MESSAGE_LIMIT);
});

test("homework formatter does not exceed Telegram limit for a very large list", () => {
  const text = formatHomework({ chatId: 1, threadId: 2, type: "MIPT", items: Array.from({ length: 100 }, (_, index) => ({ id: index + 1, type: "MIPT", subject: "Теория вероятностей", description: "Очень длинное домашнее задание ".repeat(30), subgroup: "ALL", deadline: null, archived: false, completed: false, authorId: 1, createdAt: new Date(), updatedAt: new Date() })) });
  assert.ok(text.length <= TELEGRAM_MESSAGE_LIMIT);
  assert.match(text, /ограничения Telegram/);
});
