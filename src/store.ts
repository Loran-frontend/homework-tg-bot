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

  async getTopic(chatId: number, threadId: number): Promise<TopicHomework> {
    const now = new Date();
    const topic = await this.prisma.topic.findFirst({
      where: { group: { chatId: BigInt(chatId) }, messageThreadId: threadId },
      include: {
        group: true,
        homeworkList: {
          include: {
            items: {
              where: { archived: false, OR: [{ deadline: null }, { deadline: { gt: now } }] },
              orderBy: { id: "asc" },
            },
          },
        },
      },
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

  async add(chatId: number, threadId: number, text: string, author: TelegramUserInput, deadline?: Date): Promise<HomeworkItem> {
    return this.prisma.$transaction(async (tx) => {
      const { list, userId } = await this.ensureContext(tx, chatId, threadId, data.type, author);
      if (userId === undefined) throw new Error("Homework author is required");
      return tx.homeworkItem.create({ data: { listId: list.id, authorId: userId, text, deadline } });
    });
  }

  async edit(chatId: number, threadId: number, id: number, text: string): Promise<HomeworkItem | null> {
    const topic = await this.getTopicRecord(chatId, threadId);
    if (!topic?.homeworkList) return null;

    const item = await this.prisma.homeworkItem.findFirst({ where: { id, listId: topic.homeworkList.id, archived: false } });
    if (!item) return null;
    return this.prisma.homeworkItem.update({ where: { id }, data: { text } });
  }

  async remove(chatId: number, threadId: number, id: number): Promise<{ removed: boolean; type?: HomeworkType }> {
    const found = await this.findItem(chatId, threadId, id);
    if (!found) return { removed: false };
    const result = await this.prisma.homeworkItem.deleteMany({ where: { id, list: { topicId: found.topicId } } });
    return { removed: result.count === 1, type: found.type };
  }

    const result = await this.prisma.homeworkItem.deleteMany({ where: { id, listId: topic.homeworkList.id, archived: false } });
    return result.count === 1;
  }

  async getPersistentMessageId(chatId: number, threadId: number, messageType: PersistentMessageType): Promise<number | null> {
    const message = await this.prisma.persistentMessage.findFirst({
      where: { topic: { group: { chatId: BigInt(chatId) }, messageThreadId: threadId }, messageType },
      select: { messageId: true },
    });
    return message?.messageId ?? null;
  }

    const item = await this.prisma.homeworkItem.findFirst({
      where: { id, listId: topic.homeworkList.id, archived: false },
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

  async archiveExpired(now = new Date()): Promise<Array<{ chatId: number; threadId: number }>> {
    const dueItems = await this.prisma.homeworkItem.findMany({
      where: { archived: false, deadline: { lte: now } },
      select: { id: true, list: { select: { topic: { select: { messageThreadId: true, group: { select: { chatId: true } } } } } } },
    });

    if (dueItems.length === 0) return [];

    await this.prisma.homeworkItem.updateMany({
      where: { id: { in: dueItems.map((item) => item.id) }, archived: false, deadline: { lte: now } },
      data: { archived: true },
    });

    const topics = new Map<string, { chatId: number; threadId: number }>();
    for (const item of dueItems) {
      const topic = item.list.topic;
      const chatId = Number(topic.group.chatId);
      topics.set(`${chatId}:${topic.messageThreadId}`, { chatId, threadId: topic.messageThreadId });
    }
    return [...topics.values()];
  }

  async setMessageId(chatId: number, threadId: number, messageId: number | null): Promise<void> {
    const topic = await this.getTopicRecord(chatId, threadId);
    if (!topic?.homeworkList) {
      await this.ensureTopic(chatId, threadId);
      return this.setMessageId(chatId, threadId, messageId);
    }

  async setUserSubgroup(telegramId: number, subgroup: HomeworkSubgroup, input?: TelegramUserInput): Promise<void> {
    await this.prisma.telegramUser.upsert({ where: { telegramId: BigInt(telegramId) }, update: { subgroup, username: input?.username, firstName: input?.firstName, lastName: input?.lastName }, create: { telegramId: BigInt(telegramId), subgroup, username: input?.username, firstName: input?.firstName, lastName: input?.lastName } });
  }

  async ensureTopic(chatId: number, threadId: number, type: HomeworkType): Promise<TopicHomework> {
    return this.prisma.$transaction(async (tx) => {
      const { list } = await this.ensureContext(tx, chatId, threadId);
      const topic = await tx.topic.findUniqueOrThrow({
        where: { id: list.topicId },
        include: {
          group: true,
          homeworkList: { include: { items: { where: { archived: false }, orderBy: { id: "asc" } } } },
        },
      });
      return this.toTopicHomework(topic);
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
