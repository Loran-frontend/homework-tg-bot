import assert from "node:assert/strict";
import test from "node:test";
import { formatPersistentMessages } from "./format.js";

test("persistent homework output uses HomeworkItem.id as the command number", () => {
  const now = new Date("2026-09-17T00:00:00.000Z");
  const data = {
    chatId: 0,
    threadId: 0,
    active: [
      {
        chatId: 0,
        threadId: 0,
        type: "IRNITU" as const,
        items: [
          {
            id: 15,
            type: "IRNITU" as const,
            subject: "Вычислительная математика",
            description: "задача",
            subgroup: "ALL" as const,
            deadline: null,
            archived: false,
            completed: false,
            authorId: 7,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    ],
    archive: [],
  };

  const output = formatPersistentMessages(data).active;
  assert.match(output, /15\.\s+⬜/u);
});

test("empty persistent lists render an explicit empty state", () => {
  const output = formatPersistentMessages({
    chatId: 0,
    threadId: 0,
    active: [],
    archive: [],
  });

  assert.match(output, /Актуальные ДЗ/iu);
  assert.match(output, /Нет заданий\./u);
});
