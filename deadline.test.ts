import assert from "node:assert/strict";
import test from "node:test";
import { HomeworkStore } from "./store.js";
import { parseDeadline } from "./bot.js";

test("parseDeadline uses one stable UTC interpretation", () => {
  const deadline = parseDeadline("20.09.2026 23:59");
  assert.ok(deadline);
  assert.equal(deadline.toISOString(), "2026-09-20T23:59:00.000Z");
});

test("parseDeadline rejects invalid dates", () => {
  assert.equal(parseDeadline("31.02.2026 23:59"), null);
  assert.equal(parseDeadline("20.09.2026 24:00"), null);
});

test("archiveExpired archives only non-archived homework with a reached deadline", async () => {
  const now = new Date("2026-09-20T23:59:00.000Z");
  const updates: unknown[] = [];
  const prisma = {
    homeworkItem: {
      findMany: async (args: unknown) => {
        assert.deepEqual(args, {
          where: { archived: false, deadline: { lte: now } },
          select: { id: true, list: { select: { topic: { select: { messageThreadId: true, group: { select: { chatId: true } } } } } } },
        });
        return [
          { id: 1, list: { topic: { messageThreadId: 100, group: { chatId: 123n } } } },
          { id: 2, list: { topic: { messageThreadId: 100, group: { chatId: 123n } } } },
        ];
      },
      updateMany: async (args: unknown) => {
        updates.push(args);
        return { count: 2 };
      },
    },
  };

  const store = new HomeworkStore(prisma as never);
  const topics = await store.archiveExpired(now);

  assert.deepEqual(updates, [{
    where: { id: { in: [1, 2] }, archived: false, deadline: { lte: now } },
    data: { archived: true },
  }]);
  assert.deepEqual(topics, [{ chatId: 123, threadId: 100 }]);
});

test("archiveExpired does nothing when no deadline has expired", async () => {
  let updateCalled = false;
  const prisma = {
    homeworkItem: {
      findMany: async () => [],
      updateMany: async () => { updateCalled = true; return { count: 0 }; },
    },
  };
  const store = new HomeworkStore(prisma as never);
  const topics = await store.archiveExpired(new Date("2026-09-20T23:59:00.000Z"));
  assert.deepEqual(topics, []);
  assert.equal(updateCalled, false);
});
