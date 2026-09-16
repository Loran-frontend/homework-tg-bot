import { PrismaClient, Prisma } from "@prisma/client";
import { HomeworkStore } from "./store.js";
import type { HomeworkItem, HomeworkSubgroup, HomeworkType, PersistentMessageType, TelegramUserInput, TopicMessages } from "./types.js";

type Topic = { chatId: number; threadId: number };
type PersistentMessageInfo = { messageId: number; destinationChatId: number | null; destinationThreadId: number | null };

declare module "./store.js" {
  interface HomeworkStore {
    addHomework(topic: Topic, type: HomeworkType, subject: string, description: string, subgroup: HomeworkSubgroup, deadline: Date | null, author: TelegramUserInput): Promise<HomeworkItem>;
    editHomework(topic: Topic, id: number, description: string, userId?: number, author?: TelegramUserInput): Promise<HomeworkItem | null>;
    deleteHomework(topic: Topic, id: number, userId?: number, author?: TelegramUserInput): Promise<{ removed: boolean; type?: HomeworkType }>;
    completeHomework(topic: Topic, id: number, userId?: number, author?: TelegramUserInput): Promise<{ item: HomeworkItem; alreadyDone: boolean } | null>;
  }
}

const SYSTEM_TOPIC: Topic = { chatId: 0, threadId: 0 };

HomeworkStore.prototype.addHomework = function (_topic, type, subject, description, subgroup, deadline, author) {
  return this.add(SYSTEM_TOPIC.chatId, SYSTEM_TOPIC.threadId, { type, subject, description, subgroup, deadline }, author);
};

HomeworkStore.prototype.editHomework = function (_topic, id, description) {
  return this.edit(SYSTEM_TOPIC.chatId, SYSTEM_TOPIC.threadId, id, description);
};

HomeworkStore.prototype.deleteHomework = function (_topic, id) {
  return this.remove(SYSTEM_TOPIC.chatId, SYSTEM_TOPIC.threadId, id);
};

HomeworkStore.prototype.completeHomework = function (_topic, id) {
  return this.markDone(SYSTEM_TOPIC.chatId, SYSTEM_TOPIC.threadId, id);
};

// Homework is stored in the reserved system Topic. The Topic where /add was
// entered is only the command/session context and is never used as storage.
HomeworkStore.prototype.getTopicMessages = async function (chatId, threadId): Promise<TopicMessages> {
  await this.archiveExpired();
  const [active, archive, miptActive, miptArchive] = await Promise.all([
    this.getTopic(SYSTEM_TOPIC.chatId, SYSTEM_TOPIC.threadId, "IRNITU", false),
    this.getTopic(SYSTEM_TOPIC.chatId, SYSTEM_TOPIC.threadId, "IRNITU", true),
    this.getTopic(SYSTEM_TOPIC.chatId, SYSTEM_TOPIC.threadId, "MIPT", false),
    this.getTopic(SYSTEM_TOPIC.chatId, SYSTEM_TOPIC.threadId, "MIPT", true),
  ]);
  const prisma = (this as unknown as { prisma: PrismaClient }).prisma;
  const messages = await prisma.persistentMessage.findMany({
    where: { topic: { group: { chatId: BigInt(chatId) }, messageThreadId: threadId } },
    select: { messageType: true, messageId: true, destinationChatId: true, destinationThreadId: true },
  });
  const activeMessage = messages.find((message) => message.messageType === "ACTIVE");
  const archiveMessage = messages.find((message) => message.messageType === "ARCHIVE");
  return {
    chatId,
    threadId,
    activeMessageId: activeMessage?.messageId,
    activeChatId: activeMessage?.destinationChatId == null ? undefined : Number(activeMessage.destinationChatId),
    archiveMessageId: archiveMessage?.messageId,
    archiveChatId: archiveMessage?.destinationChatId == null ? undefined : Number(archiveMessage.destinationChatId),
    active: [active, miptActive],
    archive: [archive, miptArchive],
  };
};

// Output messages have one global destination per type. This deliberately
// ignores the command Topic so /add, /list and deadline archiving all update
// the same configured ACTIVE/ARCHIVE messages.
HomeworkStore.prototype.getPersistentMessageInfo = async function (_chatId, _threadId, messageType): Promise<PersistentMessageInfo | null> {
  const prisma = (this as unknown as { prisma: PrismaClient }).prisma;
  const system = await ensureSystemPersistentMessage(prisma, messageType);
  if (!system) return null;
  return {
    messageId: system.messageId,
    destinationChatId: system.destinationChatId == null ? null : Number(system.destinationChatId),
    destinationThreadId: system.destinationThreadId,
  };
};

HomeworkStore.prototype.setPersistentMessageDestination = async function (_chatId, _threadId, messageType, destinationChatId, destinationThreadId): Promise<void> {
  const prisma = (this as unknown as { prisma: PrismaClient }).prisma;
  const topic = await ensureSystemTopic(prisma);
  await prisma.persistentMessage.upsert({
    where: { topicId_messageType: { topicId: topic.id, messageType } },
    update: { destinationChatId: BigInt(destinationChatId), destinationThreadId, messageId: 0 },
    create: { topicId: topic.id, messageType, messageId: 0, destinationChatId: BigInt(destinationChatId), destinationThreadId },
  });
};

HomeworkStore.prototype.getPersistentMessageId = async function (_chatId, _threadId, messageType): Promise<number | null> {
  const info = await this.getPersistentMessageInfo(SYSTEM_TOPIC.chatId, SYSTEM_TOPIC.threadId, messageType);
  return info?.messageId && info.messageId > 0 ? info.messageId : null;
};

HomeworkStore.prototype.withPersistentMessageLock = async function <T>(
  _chatId,
  _threadId,
  messageType,
  callback: (messageId: number | null, setMessageId: (id: number) => Promise<void>) => Promise<T>,
): Promise<T> {
  const prisma = (this as unknown as { prisma: PrismaClient }).prisma;
  return prisma.$transaction(async (tx) => {
    const topic = await ensureSystemTopic(tx);
    const lockKey = `homework-output:${messageType}`;
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const record = await tx.persistentMessage.findUnique({
      where: { topicId_messageType: { topicId: topic.id, messageType } },
      select: { messageId: true },
    });
    const setMessageId = async (id: number): Promise<void> => {
      await tx.persistentMessage.upsert({
        where: { topicId_messageType: { topicId: topic.id, messageType } },
        update: { messageId: id },
        create: { topicId: topic.id, messageType, messageId: id },
      });
    };
    return callback(record?.messageId && record.messageId > 0 ? record.messageId : null, setMessageId);
  });
};

// Commands use the current Topic only as the configuration scope. Homework itself
// lives in the reserved system Topic, so /add in Topic A never creates homework
// belonging to Topic A.

HomeworkStore.prototype.archiveExpired = async function (now = new Date()): Promise<Array<Topic>> {
  const prisma = (this as unknown as { prisma: PrismaClient }).prisma;
  const dueItems = await prisma.homeworkItem.findMany({
    where: { archived: false, deadline: { lte: now } },
    select: { id: true },
  });
  if (dueItems.length === 0) return [];

  await prisma.homeworkItem.updateMany({
    where: { id: { in: dueItems.map((item) => item.id) }, archived: false, deadline: { lte: now } },
    data: { archived: true },
  });

  // The output destination is global, so one refresh is sufficient for all
  // expired items instead of refreshing their former command Topics.
  const configured = await prisma.persistentMessage.findMany({
    where: { topic: { group: { chatId: 0n }, messageThreadId: 0 }, destinationChatId: { not: null } },
    select: { topic: { select: { messageThreadId: true, group: { select: { chatId: true } } } } },
  });
  if (configured.length === 0) return [];
  return [SYSTEM_TOPIC];
};

async function ensureSystemTopic(client: PrismaClient | Prisma.TransactionClient): Promise<{ id: number }> {
  const group = await client.telegramGroup.upsert({
    where: { chatId: 0n },
    update: {},
    create: { chatId: 0n, title: "Homework system storage" },
  });
  return client.topic.upsert({
    where: { groupId_messageThreadId: { groupId: group.id, messageThreadId: 0 } },
    update: {},
    create: { groupId: group.id, messageThreadId: 0, name: "Homework system storage" },
  });
}

async function ensureSystemPersistentMessage(client: PrismaClient): Promise<{
  messageId: number;
  destinationChatId: bigint | null;
  destinationThreadId: number | null;
} | null> {
  const topic = await ensureSystemTopic(client);
  const existing = await client.persistentMessage.findUnique({
    where: { topicId_messageType: { topicId: topic.id, messageType: "ACTIVE" } },
  });
  // Do not create empty ACTIVE/ARCHIVE records merely by reading settings.
  // The caller that configures a destination creates the actual record.
  if (!existing) {
    const configured = await client.persistentMessage.findFirst({
      where: { messageType: { in: ["ACTIVE", "ARCHIVE"] }, destinationChatId: { not: null } },
      orderBy: { updatedAt: "desc" },
    });
    if (!configured) return null;
    const migrated = await client.persistentMessage.upsert({
      where: { topicId_messageType: { topicId: topic.id, messageType: configured.messageType } },
      update: {
        messageId: configured.messageId,
        destinationChatId: configured.destinationChatId,
        destinationThreadId: configured.destinationThreadId,
      },
      create: {
        topicId: topic.id,
        messageType: configured.messageType,
        messageId: configured.messageId,
        destinationChatId: configured.destinationChatId,
        destinationThreadId: configured.destinationThreadId,
      },
    });
    return migrated;
  }
  const messageType = existing.messageType;
  return client.persistentMessage.findUnique({
    where: { topicId_messageType: { topicId: topic.id, messageType } },
  });
}
