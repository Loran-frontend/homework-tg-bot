import { PrismaClient } from "@prisma/client";
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

// Commands use the current Topic only as the configuration scope. Homework itself
// lives in the reserved system Topic, so /add in Topic A never creates homework
// belonging to Topic A.
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

  const configured = await prisma.persistentMessage.findMany({
    where: { destinationChatId: { not: null } },
    select: { topic: { select: { messageThreadId: true, group: { select: { chatId: true } } } } },
  });
  const topics = new Map<string, Topic>();
  for (const item of configured) {
    const topic = { chatId: Number(item.topic.group.chatId), threadId: item.topic.messageThreadId };
    topics.set(`${topic.chatId}:${topic.threadId}`, topic);
  }
  return [...topics.values()];
};
