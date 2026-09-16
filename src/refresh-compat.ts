import { Bot } from "grammy";
import { HomeworkStore } from "./store.js";
import { formatPersistentMessages } from "./format.js";
import type { PersistentMessageType } from "./types.js";

type Topic = { chatId: number; threadId: number };

const refreshLocks = new Map<string, Promise<void>>();

export async function refreshMessage(bot: Bot, store: HomeworkStore, topic: Topic): Promise<void> {
  await refreshOutputMessage(bot, store, topic, "ACTIVE");
  await refreshOutputMessage(bot, store, topic, "ARCHIVE");
}

async function refreshOutputMessage(bot: Bot, store: HomeworkStore, topic: Topic, messageType: PersistentMessageType): Promise<void> {
  const lockKey = `${topic.chatId}:${topic.threadId}:${messageType}`;
  const previous = refreshLocks.get(lockKey) ?? Promise.resolve();
  const next = previous.then(async () => {
    const data = await store.getTopicMessages(topic.chatId, topic.threadId);
    const text = formatPersistentMessages(data)[messageType === "ACTIVE" ? "active" : "archive"];
    const saved = await store.getPersistentMessageInfo(topic.chatId, topic.threadId, messageType);
    if (!saved || saved.destinationChatId === null) return;

    await store.withPersistentMessageLock(topic.chatId, topic.threadId, messageType, async (messageId, setMessageId) => {
      const destinationChatId = saved.destinationChatId as number;

      if (messageId) {
        try {
          await bot.api.editMessageText(destinationChatId, messageId, text, { parse_mode: "HTML" });
          return;
        } catch (error) {
          console.warn(`Could not edit ${messageType} output message:`, error);
        }
      }

      const options: { parse_mode: "HTML"; message_thread_id?: number } = { parse_mode: "HTML" };
      if (destinationChatId === topic.chatId && topic.threadId > 0) options.message_thread_id = topic.threadId;
      const message = await bot.api.sendMessage(destinationChatId, text, options);
      await setMessageId(message.message_id);

      try {
        await bot.api.pinChatMessage(destinationChatId, message.message_id, { disable_notification: true });
      } catch (error) {
        console.warn(`Could not pin ${messageType} output message:`, error);
      }
    });
  });

  refreshLocks.set(lockKey, next);
  try { await next; } finally { if (refreshLocks.get(lockKey) === next) refreshLocks.delete(lockKey); }
}
