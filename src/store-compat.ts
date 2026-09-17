import { PrismaClient, Prisma } from "@prisma/client";
import { HomeworkStore } from "./store.js";
import type { HomeworkItem, HomeworkSubgroup, HomeworkType, PersistentMessageType, TelegramUserInput, TopicMessages } from "./types.js";

type Topic = { chatId: number; threadId: number };
type PersistentMessageInfo = { messageId: number; destinationChatId: number | null; destinationThreadId: number | null };
type PersistentMessageCallback = (messageId: number | null, setMessageId: (id: number) => Promise<void>) => Promise<unknown>;
type GroupRoleInfo = { telegramId: number; role: "ADMIN" };

declare module "./store.js" {
  interface HomeworkStore {
    addHomework(topic: Topic, type: HomeworkType, subject: string, description: string, subgroup: HomeworkSubgroup, deadline: Date | null, author: TelegramUserInput): Promise<HomeworkItem>;
    editHomework(topic: Topic, id: number, description: string, userId?: number, author?: TelegramUserInput): Promise<HomeworkItem | null>;
    deleteHomework(topic: Topic, id: number, userId?: number, author?: TelegramUserInput): Promise<{ removed: boolean; type?: HomeworkType }>;
    setPersistentMessageId(chatId: number, threadId: number, messageType: PersistentMessageType, messageId: number): Promise<void>;
    setGroupOwner(chatId: number, telegramId: number, title?: string): Promise<void>;
    isGroupOwner(chatId: number, telegramId: number): Promise<boolean>;
    isGroupAdmin(chatId: number, telegramId: number): Promise<boolean>;
    addGroupAdmin(chatId: number, telegramId: number, title?: string): Promise<void>;
    removeGroupAdmin(chatId: number, telegramId: number): Promise<void>;
    listGroupAdmins(chatId: number): Promise<GroupRoleInfo[]>;
  }
}

const SYSTEM_TOPIC: Topic = { chatId: 0, threadId: 0 };

HomeworkStore.prototype.addHomework = function (_topic, type, subject, description, subgroup, deadline, author) {
  return this.add(SYSTEM_TOPIC.chatId, SYSTEM_TOPIC.threadId, { type, subject, description, subgroup, deadline }, author);
};
HomeworkStore.prototype.editHomework = function (_topic, id, description, userId) {
  return this.edit(SYSTEM_TOPIC.chatId, SYSTEM_TOPIC.threadId, id, description, userId);
};
HomeworkStore.prototype.deleteHomework = function (_topic, id, userId) {
  return this.remove(SYSTEM_TOPIC.chatId, SYSTEM_TOPIC.threadId, id, userId);
};

HomeworkStore.prototype.setGroupOwner = async function (chatId: number, telegramId: number, title?: string): Promise<void> {
  const prisma = (this as unknown as { prisma: PrismaClient }).prisma;
  await prisma.telegramGroup.upsert({ where: { chatId: BigInt(chatId) }, update: { ownerTelegramId: BigInt(telegramId), ...(title ? { title } : {}) }, create: { chatId: BigInt(chatId), ownerTelegramId: BigInt(telegramId), title } });
};

HomeworkStore.prototype.isGroupOwner = async function (chatId: number, telegramId: number): Promise<boolean> {
  const prisma = (this as unknown as { prisma: PrismaClient }).prisma;
  const group = await prisma.telegramGroup.findUnique({ where: { chatId: BigInt(chatId) }, select: { ownerTelegramId: true } });
  return group?.ownerTelegramId === BigInt(telegramId);
};

HomeworkStore.prototype.isGroupAdmin = async function (chatId: number, telegramId: number): Promise<boolean> {
  const prisma = (this as unknown as { prisma: PrismaClient }).prisma;
  const group = await prisma.telegramGroup.findUnique({ where: { chatId: BigInt(chatId) }, select: { id: true } });
  if (!group) return false;
  const role = await prisma.telegramGroupRole.findUnique({ where: { groupId_telegramId: { groupId: group.id, telegramId: BigInt(telegramId) } }, select: { role: true } });
  return role?.role === "ADMIN";
};

HomeworkStore.prototype.addGroupAdmin = async function (chatId: number, telegramId: number, title?: string): Promise<void> {
  const prisma = (this as unknown as { prisma: PrismaClient }).prisma;
  const group = await prisma.telegramGroup.upsert({ where: { chatId: BigInt(chatId) }, update: title ? { title } : {}, create: { chatId: BigInt(chatId), title } });
  await prisma.telegramGroupRole.upsert({ where: { groupId_telegramId: { groupId: group.id, telegramId: BigInt(telegramId) } }, update: { role: "ADMIN" }, create: { groupId: group.id, telegramId: BigInt(telegramId), role: "ADMIN" } });
};

HomeworkStore.prototype.removeGroupAdmin = async function (chatId: number, telegramId: number): Promise<void> {
  const prisma = (this as unknown as { prisma: PrismaClient }).prisma;
  const group = await prisma.telegramGroup.findUnique({ where: { chatId: BigInt(chatId) }, select: { id: true } });
  if (!group) return;
  await prisma.telegramGroupRole.deleteMany({ where: { groupId: group.id, telegramId: BigInt(telegramId) } });
};

HomeworkStore.prototype.listGroupAdmins = async function (chatId: number): Promise<GroupRoleInfo[]> {
  const prisma = (this as unknown as { prisma: PrismaClient }).prisma;
  const group = await prisma.telegramGroup.findUnique({ where: { chatId: BigInt(chatId) }, select: { id: true } });
  if (!group) return [];
  const roles = await prisma.telegramGroupRole.findMany({ where: { groupId: group.id }, select: { telegramId: true, role: true }, orderBy: { createdAt: "asc" } });
  return roles.map((item) => ({ telegramId: Number(item.telegramId), role: item.role }));
};

HomeworkStore.prototype.getTopicMessages = async function (chatId: number, threadId: number): Promise<TopicMessages> {
  await this.archiveExpired();
  const [active, archive, miptActive, miptArchive] = await Promise.all([this.getTopic(SYSTEM_TOPIC.chatId, SYSTEM_TOPIC.threadId, "IRNITU", false), this.getTopic(SYSTEM_TOPIC.chatId, SYSTEM_TOPIC.threadId, "IRNITU", true), this.getTopic(SYSTEM_TOPIC.chatId, SYSTEM_TOPIC.threadId, "MIPT", false), this.getTopic(SYSTEM_TOPIC.chatId, SYSTEM_TOPIC.threadId, "MIPT", true)]);
  const prisma = (this as unknown as { prisma: PrismaClient }).prisma;
  const messages = await prisma.persistentMessage.findMany({ where: { topic: { group: { chatId: BigInt(chatId) }, messageThreadId: threadId } }, select: { messageType: true, messageId: true, destinationChatId: true, destinationThreadId: true } });
  const activeMessage = messages.find((message) => message.messageType === "ACTIVE");
  const archiveMessage = messages.find((message) => message.messageType === "ARCHIVE");
  return { chatId, threadId, activeMessageId: activeMessage?.messageId, activeChatId: activeMessage?.destinationChatId == null ? undefined : Number(activeMessage.destinationChatId), archiveMessageId: archiveMessage?.messageId, archiveChatId: archiveMessage?.destinationChatId == null ? undefined : Number(archiveMessage.destinationChatId), active: [active, miptActive], archive: [archive, miptArchive] };
};

HomeworkStore.prototype.getPersistentMessageInfo = async function (_chatId, _threadId, messageType) {
  const prisma = (this as unknown as { prisma: PrismaClient }).prisma;
  const system = await ensureSystemPersistentMessage(prisma, messageType);
  if (!system) return null;
  return { messageId: system.messageId, destinationChatId: system.destinationChatId == null ? null : Number(system.destinationChatId), destinationThreadId: system.destinationThreadId };
};

HomeworkStore.prototype.setPersistentMessageId = async function (_chatId, _threadId, messageType, messageId) {
  const prisma = (this as unknown as { prisma: PrismaClient }).prisma;
  const topic = await ensureSystemTopic(prisma);
  await prisma.persistentMessage.update({ where: { topicId_messageType: { topicId: topic.id, messageType } }, data: { messageId } });
};

HomeworkStore.prototype.setPersistentMessageDestination = async function (_chatId, _threadId, messageType, destinationChatId, destinationThreadId) {
  const prisma = (this as unknown as { prisma: PrismaClient }).prisma;
  const topic = await ensureSystemTopic(prisma);
  await prisma.persistentMessage.upsert({ where: { topicId_messageType: { topicId: topic.id, messageType } }, update: { destinationChatId: BigInt(destinationChatId), destinationThreadId, messageId: 0 }, create: { topicId: topic.id, messageType, messageId: 0, destinationChatId: BigInt(destinationChatId), destinationThreadId } });
};

HomeworkStore.prototype.getPersistentMessageId = async function (_chatId, _threadId, messageType) {
  const info = await this.getPersistentMessageInfo(SYSTEM_TOPIC.chatId, SYSTEM_TOPIC.threadId, messageType);
  return info?.messageId && info.messageId > 0 ? info.messageId : null;
};

HomeworkStore.prototype.withPersistentMessageLock = async function <T>(_chatId, _threadId, messageType, callback: PersistentMessageCallback): Promise<T> {
  const prisma = (this as unknown as { prisma: PrismaClient }).prisma;
  return prisma.$transaction(async (tx) => {
    const topic = await ensureSystemTopic(tx);
    const lockKey = `homework-output:${messageType}`;
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const record = await tx.persistentMessage.findUnique({ where: { topicId_messageType: { topicId: topic.id, messageType } }, select: { messageId: true } });
    const setMessageId = async (id: number): Promise<void> => { await tx.persistentMessage.upsert({ where: { topicId_messageType: { topicId: topic.id, messageType } }, update: { messageId: id }, create: { topicId: topic.id, messageType, messageId: id } }); };
    return callback(record?.messageId && record.messageId > 0 ? record.messageId : null, setMessageId) as T;
  });
};

HomeworkStore.prototype.archiveExpired = async function (now: Date = new Date()): Promise<Array<Topic>> {
  const prisma = (this as unknown as { prisma: PrismaClient }).prisma;
  const dueItems = await prisma.homeworkItem.findMany({ where: { archived: false, deadline: { lte: now } }, select: { id: true } });
  if (dueItems.length === 0) return [];
  await prisma.homeworkItem.updateMany({ where: { id: { in: dueItems.map((item) => item.id) }, archived: false, deadline: { lte: now } }, data: { archived: true } });
  const configured = await prisma.persistentMessage.findMany({ where: { topic: { group: { chatId: 0n }, messageThreadId: 0 }, destinationChatId: { not: null } }, select: { id: true } });
  return configured.length > 0 ? [SYSTEM_TOPIC] : [];
};

async function ensureSystemTopic(client: PrismaClient | Prisma.TransactionClient): Promise<{ id: number }> {
  const group = await client.telegramGroup.upsert({ where: { chatId: 0n }, update: {}, create: { chatId: 0n, title: "Homework system storage" } });
  return client.topic.upsert({ where: { groupId_messageThreadId: { groupId: group.id, messageThreadId: 0 } }, update: {}, create: { groupId: group.id, messageThreadId: 0, name: "Homework system storage" } });
}

async function ensureSystemPersistentMessage(client: PrismaClient, messageType: PersistentMessageType): Promise<{ messageId: number; destinationChatId: bigint | null; destinationThreadId: number | null } | null> {
  const topic = await ensureSystemTopic(client);
  const existing = await client.persistentMessage.findUnique({ where: { topicId_messageType: { topicId: topic.id, messageType } } });
  if (existing) return existing;
  const configured = await client.persistentMessage.findFirst({ where: { messageType, destinationChatId: { not: null } }, orderBy: { updatedAt: "desc" } });
  if (!configured) return null;
  return client.persistentMessage.upsert({ where: { topicId_messageType: { topicId: topic.id, messageType } }, update: { messageId: configured.messageId, destinationChatId: configured.destinationChatId, destinationThreadId: configured.destinationThreadId }, create: { topicId: topic.id, messageType, messageId: configured.messageId, destinationChatId: configured.destinationChatId, destinationThreadId: configured.destinationThreadId } });
}
