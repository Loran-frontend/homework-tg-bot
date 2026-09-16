import { HomeworkStore } from "./store.js";
import type { HomeworkItem, HomeworkSubgroup, HomeworkType, TelegramUserInput } from "./types.js";

declare module "./store.js" {
  interface HomeworkStore {
    addHomework(topic: { chatId: number; threadId: number }, type: HomeworkType, subject: string, description: string, subgroup: HomeworkSubgroup, deadline: Date | null, author: TelegramUserInput): Promise<HomeworkItem>;
    editHomework(topic: { chatId: number; threadId: number }, id: number, description: string, userId?: number, author?: TelegramUserInput): Promise<HomeworkItem | null>;
    deleteHomework(topic: { chatId: number; threadId: number }, id: number, userId?: number, author?: TelegramUserInput): Promise<{ removed: boolean; type?: HomeworkType }>;
    completeHomework(topic: { chatId: number; threadId: number }, id: number, userId?: number, author?: TelegramUserInput): Promise<{ item: HomeworkItem; alreadyDone: boolean } | null>;
  }
}

HomeworkStore.prototype.addHomework = function (topic, type, subject, description, subgroup, deadline, author) {
  return this.add(topic.chatId, topic.threadId, { type, subject, description, subgroup, deadline }, author);
};

HomeworkStore.prototype.editHomework = function (topic, id, description) {
  return this.edit(topic.chatId, topic.threadId, id, description);
};

HomeworkStore.prototype.deleteHomework = function (topic, id) {
  return this.remove(topic.chatId, topic.threadId, id);
};

HomeworkStore.prototype.completeHomework = function (topic, id) {
  return this.markDone(topic.chatId, topic.threadId, id);
};
