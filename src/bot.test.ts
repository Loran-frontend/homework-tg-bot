import assert from "node:assert/strict";
import test from "node:test";
import { isMissingMessageError, parseDeadline, parseEditCommand, parseId } from "./bot.js";
import { formatHomework, formatPersistentMessages, IRNITU_SUBJECTS, MIPT_SUBJECTS, TELEGRAM_MESSAGE_LIMIT, isValidSubject } from "./format.js";
import type { TopicMessages } from "./types.js";

const item = (id: number, type: "IRNITU" | "MIPT", subject: string, description = "Решить задачи", subgroup: "ALL" | "GROUP_1" | "GROUP_2" = "ALL", archived = false) => ({
  id, type, subject, description, subgroup, deadline: new Date(2026, 8, 25, 23, 59), archived, completed: false, authorId: 1, createdAt: new Date(), updatedAt: new Date(),
});

test("parseId accepts only positive integer ids", () => {
  assert.equal(parseId("1"), 1);
  assert.equal(parseId("0"), null);
  assert.equal(parseId("-1"), null);
  assert.equal(parseId("abc"), null);
});

test("parseEditCommand requires id and non-empty text", () => {
  assert.deepEqual(parseEditCommand("1 новое описание"), { id: 1, text: "новое описание" });
  assert.equal(parseEditCommand(""), null);
  assert.equal(parseEditCommand("1"), null);
  assert.equal(parseEditCommand("abc текст"), null);
});

test("parseDeadline validates the required future format", () => {
  const deadline = parseDeadline("25.09.2026 23:59");
  assert.ok(deadline instanceof Date);
  assert.equal(deadline?.getFullYear(), 2026);
  assert.equal(deadline?.getMonth(), 8);
  assert.equal(deadline?.getDate(), 25);
  assert.equal(parseDeadline("31.02.2026 23:59"), null);
  assert.equal(parseDeadline("25/09/2026 23:59"), null);
});

test("subject catalogs are strictly separated by homework type", () => {
  assert.equal(isValidSubject("IRNITU", IRNITU_SUBJECTS[0]), true);
  assert.equal(isValidSubject("MIPT", MIPT_SUBJECTS[0]), true);
  assert.equal(isValidSubject("IRNITU", MIPT_SUBJECTS[0]), false);
  assert.equal(isValidSubject("MIPT", IRNITU_SUBJECTS[0]), false);
});

test("formatter separates IRNITU and MIPT inside the single active message", () => {
  const data: TopicMessages = {
    chatId: 100,
    threadId: 10,
    activeMessageId: 111,
    archiveMessageId: 222,
    active: [
      { chatId: 100, threadId: 10, type: "IRNITU", items: [item(1, "IRNITU", "Вычислительная математика")] },
      { chatId: 100, threadId: 10, type: "MIPT", items: [item(2, "MIPT", "Теория вероятностей")] },
    ],
    archive: [],
  };
  const text = formatPersistentMessages(data).active;
  assert.match(text, /ДЗ ИРНИТУ/);
  assert.match(text, /ДЗ МФТИ/);
  assert.match(text, /Вычислительная математика/);
  assert.match(text, /Теория вероятностей/);
});

test("archive is a separate message and contains archived items only", () => {
  const data: TopicMessages = {
    chatId: 100,
    threadId: 10,
    activeMessageId: 111,
    archiveMessageId: 222,
    active: [{ chatId: 100, threadId: 10, type: "IRNITU", items: [item(1, "IRNITU", "Вычислительная математика")] }, { chatId: 100, threadId: 10, type: "MIPT", items: [] }],
    archive: [{ chatId: 100, threadId: 10, type: "IRNITU", items: [item(3, "IRNITU", "Иностранный язык", "Выучить слова", "ALL", true)] }, { chatId: 100, threadId: 10, type: "MIPT", items: [] }],
  };
  const texts = formatPersistentMessages(data);
  assert.match(texts.archive, /Архив ДЗ/);
  assert.match(texts.archive, /Иностранный язык/);
  assert.match(texts.archive, /Архивировано/);
  assert.doesNotMatch(texts.active, /Иностранный язык/);
});

test("missing Telegram message errors are detected", () => {
  assert.equal(isMissingMessageError({ description: "Bad Request: message to edit not found" }), true);
  assert.equal(isMissingMessageError({ description: "Bad Request: message can't be edited" }), true);
  assert.equal(isMissingMessageError(new Error("Bad Request: message is not modified")), false);
});

test("formatter escapes HTML and stays within Telegram limit", () => {
  const text = formatHomework({ chatId: 1, threadId: 2, type: "IRNITU", items: [item(1, "IRNITU", "Вычислительная математика", "<script> & \"опасный\"")] });
  assert.match(text, /&lt;script&gt; &amp; &quot;опасный&quot;/);
  assert.ok(text.length <= TELEGRAM_MESSAGE_LIMIT);
});

test("large persistent messages stay within Telegram limit", () => {
  const items = Array.from({ length: 100 }, (_, index) => item(index + 1, "MIPT", "Теория вероятностей", "Очень длинное домашнее задание ".repeat(30)));
  const data: TopicMessages = {
    chatId: 100,
    threadId: 10,
    active: [{ chatId: 100, threadId: 10, type: "IRNITU", items: [] }, { chatId: 100, threadId: 10, type: "MIPT", items }],
    archive: [],
  };
  assert.ok(formatPersistentMessages(data).active.length <= TELEGRAM_MESSAGE_LIMIT);
});
