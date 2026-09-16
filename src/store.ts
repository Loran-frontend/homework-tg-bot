import { PrismaClient, type Prisma } from "@prisma/client";
import type { HomeworkItem, TelegramUserInput, TopicHomework } from "./types.js";

export class HomeworkStore {
  constructor(private readonly prisma: PrismaClient) {}

  async connect(): Promise<void> {
    await this.prisma.$connect();
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async getTopic(chatId: number, threadId: number): Promise<TopicHomework> {
    const topic = await this.prisma.topic.findFirst({
      where: { group: { chatId: BigInt(chatId) }, messageThreadId: threadId },
      include: {
        group: true,
        homeworkList: { include: { items: { orderBy: { id: "asc" } } } },
      },
    });

    if (!topic?.homeworkList) return this.ensureTopic(chatId, threadId);
    return this.toTopicHomework(topic);
  }

  async add(chatId: number, threadId: number, text: string, author: TelegramUserInput): Promise<HomeworkItem> {
    return this.prisma.$transaction(async (tx) => {
      const { list, userId } = await this.ensureContext(tx, chatId, threadId, author);
      if (userId === undefined) throw new Error("Homework author is required");
      return tx.homeworkItem.create({ data: { listId: list.id, authorId: userId, text } });
    });
  }

  async edit(chatId: number, threadId: number, id: number, text: string): Promise<HomeworkItem | null> {
    const topic = await this.getTopicRecord(chatId, threadId);
    if (!topic) return null;

    const item = await this.prisma.homeworkItem.findFirst({ where: { id, listId: topic.homeworkList.id } });
    if (!item) return null;
    return this.prisma.homeworkItem.update({ where: { id }, data: { text } });
  }

  async remove(chatId: number, threadId: number, id: number): Promise<boolean> {
    const topic = await this.getTopicRecord(chatId, threadId);
    if (!topic) return false;

    const result = await this.prisma.homeworkItem.deleteMany({ where: { id, listId: topic.homeworkList.id } });
    return result.count === 1;
  }

  async markDone(chatId: number, threadId: number, id: number): Promise<{ item: HomeworkItem; alreadyDone: boolean } | null> {
    const topic = await this.getTopicRecord(chatId, threadId);
    if (!topic) return null;

    const item = await this.prisma.homeworkItem.findFirst({
      where: { id, listId: topic.homeworkList.id },
    });
    if (!item) return null;
    if (item.completed) return { item, alreadyDone: true };

    const updated = await this.prisma.homeworkItem.update({
      where: { id: item.id },
      data: { completed: true },
    });
    return { item: updated, alreadyDone: false };
  }

  async setMessageId(chatId: number, threadId: number, messageId: number | null): Promise<void> {
    const topic = await this.getTopicRecord(chatId, threadId);
    if (!topic) {
      await this.ensureTopic(chatId, threadId);
      return this.setMessageId(chatId, threadId, messageId);
    }

    await this.prisma.homeworkList.update({
      where: { id: topic.homeworkList.id },
      data: { primaryMessageId: messageId },
    });
  }

  async ensureTopic(chatId: number, threadId: number): Promise<TopicHomework> {
    return this.prisma.$transaction(async (tx) => {
      const { list } = await this.ensureContext(tx, chatId, threadId);
      const topic = await tx.topic.findUniqueOrThrow({
        where: { id: list.topicId },
        include: {
          group: true,
          homeworkList: { include: { items: { orderBy: { id: "asc" } } } },
        },
      });
      return this.toTopicHomework(topic);
    });
  }

  private async getTopicRecord(chatId: number, threadId: number) {
    return this.prisma.topic.findFirst({
      where: { group: { chatId: BigInt(chatId) }, messageThreadId: threadId },
      include: { homeworkList: true },
    });
  }

  private async ensureContext(tx: Prisma.TransactionClient, chatId: number, threadId: number, author?: TelegramUserInput) {
    const group = await tx.telegramGroup.upsert({
      where: { chatId: BigInt(chatId) },
      update: {},
      create: { chatId: BigInt(chatId) },
    });

    const topic = await tx.topic.upsert({
      where: { groupId_messageThreadId: { groupId: group.id, messageThreadId: threadId } },
      update: {},
      create: { groupId: group.id, messageThreadId: threadId },
    });

    const list = await tx.homeworkList.upsert({
      where: { topicId: topic.id },
      update: {},
      create: { topicId: topic.id },
    });

    if (!author) return { list, userId: undefined };

    const user = await tx.telegramUser.upsert({
      where: { telegramId: BigInt(author.telegramId) },
      update: {
        username: author.username,
        firstName: author.firstName,
        lastName: author.lastName,
      },
      create: {
        telegramId: BigInt(author.telegramId),
        username: author.username,
        firstName: author.firstName,
        lastName: author.lastName,
      },
    });

    return { list, userId: user.id };
  }

  private toTopicHomework(topic: {
    messageThreadId: number;
    group: { chatId: bigint };
    homeworkList: { primaryMessageId: number | null; items: HomeworkItem[] } | null;
  }): TopicHomework {
    if (!topic.homeworkList) throw new Error("Topic is missing its homework list");

    return {
      chatId: Number(topic.group.chatId),
      threadId: topic.messageThreadId,
      messageId: topic.homeworkList.primaryMessageId ?? undefined,
      items: topic.homeworkList.items,
    };
  }
}
