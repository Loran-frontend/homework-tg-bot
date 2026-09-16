import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { isMissingMessageError, parseAddCommand, parseDeadline, parseEditCommand, parseId, refreshMessage } from "./bot.js";
import { formatHomework, TELEGRAM_MESSAGE_LIMIT } from "./format.js";
import { HomeworkStore } from "./store.js";

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

test("parseAddCommand accepts text with optional UTC deadline", () => {
  const parsed = parseAddCommand("Решить задачи 1-10 | 25.09.2026 23:59");
  assert.equal(parsed?.text, "Решить задачи 1-10");
  assert.equal(parsed?.deadline?.toISOString(), "2026-09-25T23:59:00.000Z");
  assert.deepEqual(parseAddCommand("Прочитать параграф"), { text: "Прочитать параграф" });
});

test("parseDeadline rejects invalid calendar dates and accepts valid dates", () => {
  assert.equal(parseDeadline("31.02.2026 10:00"), null);
  assert.equal(parseDeadline("25.09.2026 23:59")?.toISOString(), "2026-09-25T23:59:00.000Z");
});

test("missing Telegram message errors are detected from ApiError description", () => {
  assert.equal(isMissingMessageError({ description: "Bad Request: message to edit not found" }), true);
  assert.equal(isMissingMessageError({ description: "Bad Request: message can't be edited" }), true);
  assert.equal(isMissingMessageError(new Error("Bad Request: message is not modified")), false);
  assert.equal(isMissingMessageError(new Error("network error")), false);
});

test("homework formatter includes deadline and stays within Telegram message limit", () => {
  const text = formatHomework({
    chatId: 1,
    threadId: 2,
    items: [{
      id: 1,
      text: "<script> & \"опасный\"",
      deadline: new Date("2026-09-25T23:59:00.000Z"),
      archived: false,
      completed: false,
      authorId: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }],
  });

  assert.match(text, /&lt;script&gt; &amp; &quot;опасный&quot;/);
  assert.match(text, /до 25\.09\.2026 23:59 UTC/);
  assert.ok(text.length <= TELEGRAM_MESSAGE_LIMIT);
});

test("homework formatter does not exceed Telegram limit for a very large list", () => {
  const text = formatHomework({
    chatId: 1,
    threadId: 2,
    items: Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      text: "Очень длинное домашнее задание ".repeat(30),
      deadline: null,
      archived: false,
      completed: false,
      authorId: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  });

  assert.ok(text.length <= TELEGRAM_MESSAGE_LIMIT);
  assert.match(text, /ограничения Telegram/);
});

test("store archives only currently active expired homework atomically", async () => {
  let updateManyWhere: unknown;
  const fakePrisma = {
    homeworkItem: {
      findMany: async () => [{
        id: 7,
        list: {
          topic: {
            messageThreadId: 22,
            group: { chatId: 123n },
          },
        },
      }],
      updateMany: async ({ where }: { where: unknown }) => {
        updateManyWhere = where;
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;

  const store = new HomeworkStore(fakePrisma);
  const now = new Date("2026-09-25T23:59:01.000Z");
  const topics = await store.archiveExpired(now);

  assert.deepEqual(topics, [{ chatId: 123, threadId: 22 }]);
  assert.deepEqual(updateManyWhere, {
    id: { in: [7] },
    archived: false,
    deadline: { lte: now },
  });
});

test("store active topic query excludes archived and expired homework", async () => {
  let capturedInclude: unknown;
  const fakePrisma = {
    topic: {
      findFirst: async ({ include }: { include: unknown }) => {
        capturedInclude = include;
        return {
          messageThreadId: 22,
          group: { chatId: 123n },
          homeworkList: { primaryMessageId: 10, items: [] },
        };
      },
    },
  } as unknown as PrismaClient;

  const store = new HomeworkStore(fakePrisma);
  const result = await store.getTopic(123, 22);

  assert.deepEqual(result.items, []);
  const itemWhere = (capturedInclude as { homeworkList: { include: { items: { where: Record<string, unknown> } } } }).homeworkList.include.items.where;
  assert.equal(itemWhere.archived, false);
  assert.ok(Array.isArray(itemWhere.OR));
  assert.equal(itemWhere.OR.length, 2);
  assert.deepEqual(itemWhere.OR[0], { deadline: null });
  assert.ok(itemWhere.OR[1] && typeof itemWhere.OR[1] === "object");
  assert.ok(itemWhere.OR[1].deadline instanceof Object);
  assert.ok(itemWhere.OR[1].deadline.gt instanceof Date);
});

test("refreshMessage edits the existing primary message after archiving", async () => {
  let editedMessageId: number | undefined;
  let editedText = "";
  const fakeStore = {
    getTopic: async () => ({ chatId: 123, threadId: 22, messageId: 10, items: [] }),
    setMessageId: async () => undefined,
  } as unknown as HomeworkStore;
  const fakeApi = {
    editMessageText: async (chatId: number, messageId: number, text: string) => {
      assert.equal(chatId, 123);
      editedMessageId = messageId;
      editedText = text;
      return true;
    },
    sendMessage: async () => {
      throw new Error("sendMessage should not be called when primary message exists");
    },
  } as unknown as Parameters<typeof refreshMessage>[0];

  await refreshMessage(fakeApi, fakeStore, { chatId: 123, threadId: 22 });

  assert.equal(editedMessageId, 10);
  assert.match(editedText, /Пока домашних заданий нет/);
});
