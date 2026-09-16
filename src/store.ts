import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { HomeworkDatabase, HomeworkItem, TopicHomework } from "./types.js";

const EMPTY_DATABASE: HomeworkDatabase = { topics: {} };

export class HomeworkStore {
  private database: HomeworkDatabase = structuredClone(EMPTY_DATABASE);

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const content = await readFile(this.filePath, "utf8");
      this.database = JSON.parse(content) as HomeworkDatabase;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
      await this.save();
    }
  }

  getTopic(chatId: number, threadId: number): TopicHomework {
    const key = this.key(chatId, threadId);
    if (!this.database.topics[key]) {
      this.database.topics[key] = { chatId, threadId, items: [] };
    }
    return this.database.topics[key];
  }

  async add(chatId: number, threadId: number, text: string): Promise<HomeworkItem> {
    const topic = this.getTopic(chatId, threadId);
    const item: HomeworkItem = {
      id: this.nextId(topic.items),
      text,
      completed: false,
    };
    topic.items.push(item);
    await this.save();
    return item;
  }

  async edit(chatId: number, threadId: number, id: number, text: string): Promise<HomeworkItem | null> {
    const item = this.getTopic(chatId, threadId).items.find((entry) => entry.id === id);
    if (!item) return null;
    item.text = text;
    await this.save();
    return item;
  }

  async remove(chatId: number, threadId: number, id: number): Promise<boolean> {
    const topic = this.getTopic(chatId, threadId);
    const index = topic.items.findIndex((entry) => entry.id === id);
    if (index === -1) return false;
    topic.items.splice(index, 1);
    await this.save();
    return true;
  }

  async toggleDone(chatId: number, threadId: number, id: number): Promise<HomeworkItem | null> {
    const item = this.getTopic(chatId, threadId).items.find((entry) => entry.id === id);
    if (!item) return null;
    item.completed = !item.completed;
    await this.save();
    return item;
  }

  async setMessageId(chatId: number, threadId: number, messageId: number): Promise<void> {
    this.getTopic(chatId, threadId).messageId = messageId;
    await this.save();
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.database, null, 2), "utf8");
  }

  private key(chatId: number, threadId: number): string {
    return `${chatId}:${threadId}`;
  }

  private nextId(items: HomeworkItem[]): number {
    return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
  }
}
