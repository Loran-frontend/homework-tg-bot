import { PrismaClient, type Prisma } from "@prisma/client";
import type { HomeworkItem, HomeworkSubgroup, HomeworkType, PersistentMessageType, TelegramUserInput, TopicHomework, TopicMessages } from "./types.js";

type HomeworkItemRecord = {
  id: number; listId: number; authorId: number; subject: string; description: string; subgroup: HomeworkSubgroup; deadline: Date | null; archived: boolean; completed: boolean; createdAt: Date; updatedAt: Date;
};

type TopicRecord = { id: number; messageThreadId: number; group: { chatId: bigint } };

export class HomeworkStore {
  constructor(private readonly prisma: PrismaClient) {}
  async connect(): Promise<void> { await this.prisma.$connect(); }
  async disconnect(): Promise<void> { await this.prisma.$disconnect(); }

  async getTopic(chatId: number, threadId: number, type: HomeworkType, archived = false): Promise<TopicHomework> {
    await this.archiveExpired(chatId, threadId);
    const topic = await this.prisma.topic.findFirst({
      where: { group: { chatId: BigInt(chatId) }, messageThreadId: threadId },
      include: { group: true, homeworkLists: { where: { type }, include: { items: { where: { archived }, orderBy: { id: "asc" } } } } },
    });
    if (!topic) return this.ensureTopic(chatId, threadId, type);
    const list = topic.homeworkLists[0] ?? await this.ensureList(topic.id, type);
    return this.toTopicHomework(topic, list);
  }

  async getTopicMessages(chatId: number, threadId: number): Promise<TopicMessages> {
    await this.archiveExpired(chatId, threadId);
    const [active, archive] = await Promise.all([
      this.getTopic(chatId, threadId, "IRNITU", false),
      this.getTopic(chatId, threadId, "IRNITU", true),
    ]);
    const [miptActive, miptArchive] = await Promise.all([
      this.getTopic(chatId, threadId, "MIPT", false),
      this.getTopic(chatId, threadId, "MIPT", true),
    ]);
    const messages = await this.prisma.persistentMessage.findMany({
      where: { topic: { group: { chatId: BigInt(chatId) }, messageThreadId: threadId } },
      select: { messageType: true, messageId: true },
    });
    const activeMessage = messages.find((message) => message.messageType === "ACTIVE");
    const archiveMessage = messages.find((message) => message.messageType === "ARCHIVE");
    return {
      chatId,
      threadId,
      activeMessageId: activeMessage?.messageId,
      archiveMessageId: archiveMessage?.messageId,
      active: [active, miptActive],
      archive: [archive, miptArchive],
    };
  }

  async getVisibleItems(chatId: number, threadId: number, subgroup: HomeworkSubgroup | null): Promise<TopicHomework[]> {
    const messages = await this.getTopicMessages(chatId, threadId);
    return messages.active.map((topic) => ({
      ...topic,
      items: subgroup ? topic.items.filter((item) => item.subgroup === "ALL" || item.subgroup === subgroup) : topic.items,
    }));
  }

  async add(chatId: number, threadId: number, data: { type: HomeworkType; subject: string; description: string; subgroup: HomeworkSubgroup; deadline: Date }, author: TelegramUserInput): Promise<HomeworkItem> {
    return this.prisma.$transaction(async (tx) => {
      const { list, userId } = await this.ensureContext(tx, chatId, threadId, data.type, author);
      if (userId === undefined) throw new Error("Homework author is required");
      const item = await tx.homeworkItem.create({ data: { listId: list.id, authorId: userId, subject: data.subject, description: data.description, subgroup: data.subgroup, deadline: data.deadline } });
      return this.toHomeworkItem(item, data.type);
    });
  }

  async edit(chatId: number, threadId: number, id: number, description: string): Promise<{ item: HomeworkItem; type: HomeworkType } | null> {
    const found = await this.findItem(chatId, threadId, id);
    if (!found) return null;
    const updated = await this.prisma.homeworkItem.updateMany({ where: { id, list: { topicId: found.topicId } }, data: { description } });
    if (updated.count !== 1) return null;
    const item = await this.prisma.homeworkItem.findUniqueOrThrow({ where: { id } });
    return { item: this.toHomeworkItem(item, found.type), type: found.type };
  }

  async remove(chatId: number, threadId: number, id: number): Promise<{ removed: boolean; type?: HomeworkType }> {
    const found = await this.findItem(chatId, threadId, id);
    if (!found) return { removed: false };
    const result = await this.prisma.homeworkItem.deleteMany({ where: { id, list: { topicId: found.topicId } } });
    return { removed: result.count === 1, type: found.type };
  }

  async markDone(chatId: number, threadId: number, id: number): Promise<{ item: HomeworkItem; type: HomeworkType; alreadyDone: boolean } | null> {
    const found = await this.findItem(chatId, threadId, id);
    if (!found) return null;
    if (found.item.completed) return { item: found.item, type: found.type, alreadyDone: true };
    const updated = await this.prisma.homeworkItem.updateMany({ where: { id, list: { topicId: found.topicId } }, data: { completed: true } });
    if (updated.count !== 1) return null;
    const item = await this.prisma.homeworkItem.findUniqueOrThrow({ where: { id } });
    return { item: this.toHomeworkItem(item, found.type), type: found.type, alreadyDone: false };
  }

  async getPersistentMessageId(chatId: number, threadId: number, messageType: PersistentMessageType): Promise<number | null> {
    const message = await this.prisma.persistentMessage.findFirst({
      where: { topic: { group: { chatId: BigInt(chatId) }, messageThreadId: threadId }, messageType },
      select: { messageId: true },
    });
    return message?.messageId ?? null;
  }

  async setPersistentMessageId(chatId: number, threadId: number, messageType: PersistentMessageType, messageId: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const topic = await this.ensureTopicRecord(tx, chatId, threadId);
      await tx.persistentMessage.upsert({
        where: { topicId_messageType: { topicId: topic.id, messageType } },
        update: { messageId },
        create: { topicId: topic.id, messageType, messageId },
      });
    });
  }

  async withPersistentMessageLock<T>(chatId: number, threadId: number, messageType: PersistentMessageType, callback: (messageId: number | null, setMessageId: (id: number) => Promise<void>) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const topic = await this.ensureTopicRecord(tx, chatId, threadId);
      const lockKey = `homework:${topic.id}:${messageType}`;
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      const record = await tx.persistentMessage.findUnique({ where: { topicId_messageType: { topicId: topic.id, messageType } }, select: { messageId: true } });
      const setMessageId = async (id: number): Promise<void> => {
        await tx.persistentMessage.upsert({ where: { topicId_messageType: { topicId: topic.id, messageType } }, update: { messageId: id }, create: { topicId: topic.id, messageType, messageId: id } });
      };
      return callback(record?.messageId ?? null, setMessageId);
    });
  }

  async getUserSubgroup(telegramId: number): Promise<HomeworkSubgroup | null> {
    const user = await this.prisma.telegramUser.findUnique({ where: { telegramId: BigInt(telegramId) }, select: { subgroup: true } });
    return user?.subgroup ?? null;
  }

  async setUserSubgroup(telegramId: number, subgroup: HomeworkSubgroup, input?: TelegramUserInput): Promise<void> {
    await this.prisma.telegramUser.upsert({ where: { telegramId: BigInt(telegramId) }, update: { subgroup, username: input?.username, firstName: input?.firstName, lastName: input?.lastName }, create: { telegramId: BigInt(telegramId), subgroup, username: input?.username, firstName: input?.firstName, lastName: input?.lastName } });
  }

  async ensureTopic(chatId: number, threadId: number, type: HomeworkType): Promise<TopicHomework> {
    return this.prisma.$transaction(async (tx) => {
      const { list } = await this.ensureContext(tx, chatId, threadId, type);
      const topic = await tx.topic.findUniqueOrThrow({ where: { id: list.topicId }, include: { group: true } });
      return this.toTopicHomework(topic, { ...list, items: [] });
    });
  }

  private async archiveExpired(chatId: number, threadId: number): Promise<void> {
    await this.prisma.homeworkItem.updateMany({ where: { list: { topic: { group: { chatId: BigInt(chatId) }, messageThreadId: threadId } }, deadline: { lt: new Date() }, archived: false }, data: { archived: true } });
  }

  private async getTopicId(chatId: number, threadId: number): Promise<number> {
    const topic = await this.prisma.topic.findFirst({ where: { group: { chatId: BigInt(chatId) }, messageThreadId: threadId }, select: { id: true } });
    if (!topic) throw new Error("Topic not found");
    return topic.id;
  }

  private async findItem(chatId: number, threadId: number, id: number): Promise<{ item: HomeworkItem; type: HomeworkType; topicId: number } | null> {
    const topicId = await this.getTopicId(chatId, threadId).catch(() => null);
    if (topicId === null) return null;
    const item = await this.prisma.homeworkItem.findFirst({ where: { id, list: { topicId } }, include: { list: { select: { type: true } } } });
    if (!item) return null;
    return { item: this.toHomeworkItem(item, item.list.type), type: item.list.type, topicId };
  }

  private async ensureList(topicId: number, type: HomeworkType) {
    return this.prisma.homeworkList.upsert({ where: { topicId_type: { topicId, type } }, update: {}, create: { topicId, type }, include: { items: { where: { archived: false }, orderBy: { id: "asc" } } } });
  }

  private async ensureTopicRecord(tx: Prisma.TransactionClient, chatId: number, threadId: number): Promise<TopicRecord> {
    const group = await tx.telegramGroup.upsert({ where: { chatId: BigInt(chatId) }, update: {}, create: { chatId: BigInt(chatId) } });
    return tx.topic.upsert({ where: { groupId_messageThreadId: { groupId: group.id, messageThreadId: threadId } }, update: {}, create: { groupId: group.id, messageThreadId: threadId }, include: { group: { select: { chatId: true } } } });
  }

  private async ensureContext(tx: Prisma.TransactionClient, chatId: number, threadId: number, type: HomeworkType, author?: TelegramUserInput) {
    const topic = await this.ensureTopicRecord(tx, chatId, threadId);
    const list = await tx.homeworkList.upsert({ where: { topicId_type: { topicId: topic.id, type } }, update: {}, create: { topicId: topic.id, type } });
    if (!author) return { list, userId: undefined };
    const user = await tx.telegramUser.upsert({ where: { telegramId: BigInt(author.telegramId) }, update: { username: author.username, firstName: author.firstName, lastName: author.lastName }, create: { telegramId: BigInt(author.telegramId), username: author.username, firstName: author.firstName, lastName: author.lastName } });
    return { list, userId: user.id };
  }

  private toTopicHomework(topic: { messageThreadId: number; group: { chatId: bigint } }, list: { type: HomeworkType; items: HomeworkItemRecord[] }): TopicHomework {
    return { chatId: Number(topic.group.chatId), threadId: topic.messageThreadId, type: list.type, items: list.items.map((item) => this.toHomeworkItem(item, list.type)) };
  }

  private toHomeworkItem(item: HomeworkItemRecord, type: HomeworkType): HomeworkItem {
    return { id: item.id, type, subject: item.subject, description: item.description, subgroup: item.subgroup, deadline: item.deadline, archived: item.archived, completed: item.completed, authorId: item.authorId, createdAt: item.createdAt, updatedAt: item.updatedAt };
  }
}
