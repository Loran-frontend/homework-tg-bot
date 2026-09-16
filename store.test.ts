import assert from "node:assert/strict";
import test from "node:test";
import { HomeworkStore } from "./store.js";

function makeItem(overrides: Partial<{
  id: number;
  authorId: number;
  subject: string;
  description: string;
  subgroup: "ALL" | "GROUP_1" | "GROUP_2";
  deadline: Date | null;
  archived: boolean;
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  const now = new Date("2026-09-17T00:00:00.000Z");
  return {
    id: 15,
    authorId: 7,
    subject: "Вычислительная математика",
    description: "старое описание",
    subgroup: "ALL" as const,
    deadline: null,
    archived: false,
    completed: false,
    createdAt: now,
    updatedAt: now,
    list: { type: "IRNITU" as const },
    ...overrides,
  };
}

test("edit resolves HomeworkItem by id, not by command Topic", async () => {
  const item = makeItem({ archived: true });
  let findWhere: unknown;
  let updateWhere: unknown;
  let updateData: unknown;
  const prisma = {
    homeworkItem: {
      findUnique: async (args: { where: unknown }) => {
        findWhere = args.where;
        return item;
      },
      update: async (args: { where: unknown; data: unknown }) => {
        updateWhere = args.where;
        updateData = args.data;
        return { ...item, description: "новое описание" };
      },
    },
    telegramUser: {
      findUnique: async () => ({ id: 7 }),
    },
  };

  const store = new HomeworkStore(prisma as never);
  const result = await store.edit(123, 456, 15, "новое описание", 42);

  assert.equal((findWhere as { id: number }).id, 15);
  assert.deepEqual(updateWhere, { id: 15 });
  assert.deepEqual(updateData, { description: "новое описание" });
  assert.equal(result?.id, 15);
  assert.equal(result?.description, "новое описание");
});

test("delete resolves HomeworkItem by id and allows archived items", async () => {
  const item = makeItem({ archived: true });
  let findWhere: unknown;
  let deleteWhere: unknown;
  const prisma = {
    homeworkItem: {
      findUnique: async (args: { where: unknown }) => {
        findWhere = args.where;
        return item;
      },
      deleteMany: async (args: { where: unknown }) => {
        deleteWhere = args.where;
        return { count: 1 };
      },
    },
    telegramUser: {
      findUnique: async () => ({ id: 7 }),
    },
  };

  const store = new HomeworkStore(prisma as never);
  const result = await store.remove(-100, 999, 15, 42);

  assert.deepEqual(findWhere, { id: 15 });
  assert.deepEqual(deleteWhere, { id: 15 });
  assert.deepEqual(result, { removed: true, type: "IRNITU" });
});
