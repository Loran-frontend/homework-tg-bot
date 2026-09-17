import { Bot } from "grammy";
import { HomeworkStore } from "./store.js";
import { formatPersistentMessages } from "./format.js";
import type { PersistentMessageType } from "./types.js";

type Topic = { chatId: number; threadId: number };

// ACTIVE and ARCHIVE each have one global configured output message. Refreshes
// from different source Topics are serialized inside this process, while all
// Telegram API calls happen OUTSIDE Prisma interactive transactions.
const refreshLocks = new Map<string, Promise<void>>();

function isMessageNotModified(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    error_code?: number;
    description?: string;
    message?: string;
  };
  const description = value.description ?? value.message ?? "";
  return value.error_code === 400 && /message is not modified/i.test(description);
}

export async function refreshMessage(bot: Bot, store: HomeworkStore, topic: Topic): Promise<void> {
  await refreshOutputMessage(bot, store, topic, "ACTIVE");
  await refreshOutputMessage(bot, store, topic, "ARCHIVE");
}

async function refreshOutputMessage(
  bot: Bot,
  store: HomeworkStore,
  topic: Topic,
  messageType: PersistentMessageType,
): Promise<void> {
  const lockKey = messageType;
  const previous = refreshLocks.get(lockKey) ?? Promise.resolve();

  const next = previous.then(async () => {
    // IMPORTANT: do not hold a Prisma interactive transaction while calling
    // Telegram. Telegram API requests can take longer than Prisma's default
    // 5-second transaction timeout and would cause P2028.
    const saved = await store.getPersistentMessageInfo(topic.chatId, topic.threadId, messageType);
    if (!saved || saved.destinationChatId === null) return;

    const data = await store.getTopicMessages(topic.chatId, topic.threadId);
    const text = formatPersistentMessages(data)[messageType === "ACTIVE" ? "active" : "archive"];

    if (saved.messageId > 0) {
      try {
        await bot.api.editMessageText(saved.destinationChatId, saved.messageId, text, { parse_mode: "HTML" });
        return;
      } catch (error) {
        // Telegram returns 400 when the generated text is byte-for-byte the
        // same as the existing message. This is a successful no-op, NOT a
        // reason to create a replacement message.
        if (isMessageNotModified(error)) return;
        console.warn(`Could not edit ${messageType} output message:`, error);
      }
    }

    // The stored message is missing/stale (for example, it was deleted in
    // Telegram). Only in that case do we create a replacement message.
    const options: { parse_mode: "HTML"; message_thread_id?: number } = { parse_mode: "HTML" };
    if (saved.destinationThreadId !== null && saved.destinationThreadId > 0) {
      options.message_thread_id = saved.destinationThreadId;
    }

    const message = await bot.api.sendMessage(saved.destinationChatId, text, options);
    await store.setPersistentMessageId(topic.chatId, topic.threadId, messageType, message.message_id);

    try {
      await bot.api.pinChatMessage(saved.destinationChatId, message.message_id, { disable_notification: true });
    } catch (error) {
      console.warn(`Could not pin ${messageType} output message:`, error);
    }
  });

  refreshLocks.set(lockKey, next);
  try {
    await next;
  } finally {
    if (refreshLocks.get(lockKey) === next) refreshLocks.delete(lockKey);
  }
}
