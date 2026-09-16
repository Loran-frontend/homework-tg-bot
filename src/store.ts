import { PrismaClient, Prisma } from "@prisma/client";
import type { HomeworkInput, HomeworkItem, HomeworkSubgroup, HomeworkType, PersistentMessageType, TelegramUserInput, TopicHomework, TopicMessages } from "./types.js";

type TopicRecord = {
  id: number;
  messageThreadId: number;
  group: { chatId: bigint };
};

type PersistentMessageInfo = {
  messageId: number;
  destinationChatId: number | null;
};

export class HomeworkStore {
  constructor(private readonly prisma: PrismaClient) {}

  async connect(): Promise<void> {
    await this.prisma.$connect();
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async getTopic(chatId: number, threadId: number, type: HomeworkType = "IRNITU", archive = false): Promise<TopicHomework> {
    const now = new Date();
    const topic = await this.prisma.topic.findFirst({
      where: { group: { chatId: BigInt(chatId) }, messageThreadId: threadId },
      include: {
        group: true,
        homeworkLists: {
          where: { type },
          include: {
            items: {
              where: archive
                ? { archived: true }
                : { archived: false, OR: [{ deadline: null }, { deadline: { gt: now } }] },
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
    await this.archiveExpired();
    const [active, archive, miptActive, miptArchive] = await Promise.all([
      this.getTopic(chatId, threadId, "IRNITU", false),
      this.getTopic(chatId, threadId, "IRNITU", true),
      this.getTopic(chatId, threadId, "MIPT", false),
      this.getTopic(chatId, threadId, "MIPT", true),
    ]);

    const messages = await this.prisma.persistentMessage.findMany({
      where: { topic: { group: { chatId: BigInt(chatId) }, messageThreadId: threadId } },
      select: { messageType: true, messageId: true, destinationChatId: true },
    });

    const activeMessage = messages.find((message) => message.messageType === "ACTIVE");
    const archiveMessage = messages.find((message) => message.messageType === "ARCHIVE");

    return {
      chatId,
      threadId,
      activeMessageId: activeMessage?.messageId,
      activeChatId: activeMessage?.destinationChatId === null || activeMessage?.destinationChatId === undefined ? undefined : Number(activeMessage.destinationChatId),
      archiveMessageId: archiveMessage?.messageId,
      archiveChatId: archiveMessage?.destinationChatId === null || archiveMessage?.destinationChatId === undefined ? undefined : Number(archiveMessage.destinationChatId),
      active: [active, miptActive],
      archive: [archive, miptArchive],
    };
  }

  async add(chatId: number, threadId: number, data: HomeworkInput, author: TelegramUserInput): Promise<HomeworkItem> {
    return this.prisma.$transaction(async (tx) => {
      const { list, userId } = await this.ensureContext(tx, chatId, threadId, data.type, author);
      if (userId === undefined) throw new Error("Homework author is required");

      const item = await tx.homeworkItem.create({
        data: {
          listId: list.id,
          authorId: userId,
          subject: data.subject,
          description: data.description,
          subgroup: data.subgroup,
          deadline: data.deadline,
        },
      });
      return this.toHomeworkItem(item, data.type);
    });
  }

  async edit(chatId: number, threadId: number, id: number, description: string): Promise<HomeworkItem | null> {
    const found = await this.findItem(chatId, threadId, id);
    if (!found || found.item.archived) return null;

    const item = await this.prisma.homeworkItem.update({ where: { id }, data: { description } });
    return this.toHomeworkItem(item, found.type);
  }

  async remove(chatId: number, threadId: number, id: number): Promise<{ removed: boolean; type?: HomeworkType }> {
    const found = await this.findItem(chatId, threadId, id);
    if (!found || found.item.archived) return { removed: false };

    const result = await this.prisma.homeworkItem.deleteMany({ where: { id } });
    return { removed: result.count === 1, type: found.type };
  }

  async markDone(chatId: number, threadId: number, id: number): Promise<{ item: HomeworkItem; alreadyDone: boolean } | null> {
    const found = await this.findItem(chatId, threadId, id);
    if (!found || found.item.archived) return null;
    if (found.item.completed) return { item: found.item, alreadyDone: true };

    const item = await this.prisma.homeworkItem.update({ where: { id }, data: { completed: true } });
    return { item: this.toHomeworkItem(item, found.type), alreadyDone: false };
  }

  async getPersistentMessageInfo(chatId: number, threadId: number, messageType: PersistentMessageType): Promise<PersistentMessageInfo | null> {
    const message = await this.prisma.persistentMessage.findFirst({
      where: { topic: { group: { chatId: BigInt(chatId) }, messageThreadId: threadId }, messageType },
      select: { messageId: true, destinationChatId: true },
    });
    if (!message) return null;
    return { messageId: message.messageId, destinationChatId: message.destinationChatId === null ? null : Number(message.destinationChatId) };
  }

  async setPersistentMessageDestination(chatId: number, threadId: number, messageType: PersistentMessageType, destinationChatId: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const topic = await this.ensureTopicRecord(tx, chatId, threadId);
      const lockKey = `homework:${topic.id}:${messageType}`;
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      await tx.persistentMessage.upsert({
        where: { topicId_messageType: { topicId: topic.id, messageType } },
        update: { destinationChatId: BigInt(destinationChatId), messageId: 0 },
        create: { topicId: topic.id, messageType, messageId: 0, destinationChatId: BigInt(destinationChatId) },
      });
    });
  }

  async getPersistentMessageId(chatId: number, threadId: number, messageType: PersistentMessageType): Promise<number | null> {
    const message = await this.prisma.persistentMessage.findFirst({
      where: { topic: { group: { chatId: BigInt(chatId) }, messageThreadId: threadId }, messageType },
      select: { messageId: true },
    });
    return message?.messageId && message.messageId > 0 ? message.messageId : null;
  }

  async withPersistentMessageLock<T>(chatId: number, threadId: number, messageType: PersistentMessageType, callback: (messageId: number | null, setMessageId: (id: number) => Promise<void>) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const topic = await this.ensureTopicRecord(tx, chatId, threadId);
      const lockKey = `homework:${topic.id}:${messageType}`;
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

  async setUserSubgroup(telegramId: number, subgroup: HomeworkSubgroup, input?: TelegramUserInput): Promise<void> {
    await this.prisma.telegramUser.upsert({
      where: { telegramId: BigInt(telegramId) },
      update: { subgroup, username: input?.username, firstName: input?.firstName, lastName: input?.lastName },
      create: { telegramId: BigInt(telegramId), subgroup, username: input?.username, firstName: input?.firstName, lastName: input?.lastName },
    });
  }

  async getUserSubgroup(telegramId: number): Promise<HomeworkSubgroup> {
    const user = await this.prisma.telegramUser.findUnique({ where: { telegramId: BigInt(telegramId) }, select: { subgroup: true } });
    return user?.subgroup ?? "ALL";
  }

  async ensureTopic(chatId: number, threadId: number, type: HomeworkType = "IRNITU"): Promise<TopicHomework> {
    return this.prisma.$transaction(async (tx) => {
      const { list } = await this.ensureContext(tx, chatId, threadId, type);
      const topic = await tx.topic.findUniqueOrThrow({
        where: { id: list.topicId },
        include: { group: true, homeworkLists: { where: { type }, include: { items: { where: { archived: false }, orderBy: { id: "asc" } } } } },
      });
      const topicList = topic.homeworkLists[0];
      if (!topicList) throw new Error("Homework list was not created");
      return this.toTopicHomework(topic, topicList);
    });
  }

  private async findItem(chatId: number, threadId: number, id: number): Promise<{ item: HomeworkItem; type: HomeworkType } | null> {
    const topic = await this.prisma.topic.findFirst({ where: { group: { chatId: BigInt(chatId) }, messageThreadId: threadId }, select: { id: true } });
    if (!topic) return null;

    const item = await this.prisma.homeworkItem.findFirst({ where: { id, list: { topicId: topic.id } }, include: { list: { select: { type: true } } } });
    if (!item) return null;
    return { item: this.toHomeworkItem(item, item.list.type), type: item.list.type };
  }

  private async ensureList(topicId: number, type: HomeworkType) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockHomeworkList(tx, topicId, type);
      return tx.homeworkList.upsert({
        where: { topicId_type: { topicId, type } },
        update: {},
        create: { topicId, type },
        include: { items: { where: { archived: false }, orderBy: { id: "asc" } } },
      });
    });
  }

  private async ensureTopicRecord(tx: Prisma.TransactionClient, chatId: number, threadId: number): Promise<TopicRecord> {
    const group = await tx.telegramGroup.upsert({ where: { chatId: BigInt(chatId) }, update: {}, create: { chatId: BigInt(chatId) } });
    return tx.topic.upsert({
      where: { groupId_messageThreadId: { groupId: group.id, messageThreadId: threadId } },
      update: {},
      create: { groupId: group.id, messageThreadId: threadId },
      include: { group: { select: { chatId: true } } },
    });
  }

  private async lockHomeworkList(tx: Prisma.TransactionClient, topicId: number, type: HomeworkType): Promise<void> {
    const lockKey = `homework-list:${topicId}:${type}`;
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
  }

  private async ensureContext(tx: Prisma.TransactionClient, chatId: number, threadId: number, type: HomeworkType, author?: TelegramUserInput) {
    const topic = await this.ensureTopicRecord(tx, chatId, threadId);
    await this.lockHomeworkList(tx, topic.id, type);
    const list = await tx.homeworkList.upsert({ where: { topicId_type: { topicId: topic.id, type } }, update: {}, create: { topicId: topic.id, type } });
    if (!author) return { list, userId: undefined as number | undefined };

    const user = await tx.telegramUser.upsert({
      where: { telegramId: BigInt(author.telegramId) },
      update: { username: author.username, firstName: author.firstName, lastName: author.lastName },
      create: { telegramId: BigInt(author.telegramId), username: author.username, firstName: author.firstName, lastName: author.lastName },
    });
    return { list, userId: user.id };
  }

  private toTopicHomework(topic: { messageThreadId: number; group: { chatId: bigint } }, list: { type: HomeworkType; items: Array<{ id: number; authorId: number; subject: string; description: string; subgroup: HomeworkSubgroup; deadline: Date | null; archived: boolean; completed: boolean; createdAt: Date; updatedAt: Date }> }): TopicHomework {
    return { chatId: Number(topic.group.chatId), threadId: topic.messageThreadId, type: list.type, items: list.items.map((item) => this.toHomeworkItem(item, list.type)) };
  }

  private toHomeworkItem(item: { id: number; authorId: number; subject: string; description: string; subgroup: HomeworkSubgroup; deadline: Date | null; archived: boolean; completed: boolean; createdAt: Date; updatedAt: Date }, type: HomeworkType): HomeworkItem {
    return { id: item.id, type, subject: item.subject, description: item.description, subgroup: item.subgroup, deadline: item.deadline, archived: item.archived, completed: item.completed, authorId: item.authorId, createdAt: item.createdAt, updatedAt: item.updatedAt };
  }
}
