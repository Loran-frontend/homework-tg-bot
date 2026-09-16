import { Bot } from "grammy";
import { HomeworkStore } from "./store.js";
import { formatPersistentMessages } from "./format.js";
import type { PersistentMessageType } from "./types.js";

type Topic = { chatId: number; threadId: number };

// ACTIVE and ARCHIVE each have one global configured output message. Do not
// serialize by the source Topic because different Topics can refresh the same
// Telegram message.
const refreshLocks = new Map<string, Promise<void>>();

export async function refreshMessage(bot: Bot, store: HomeworkStore, topic: Topic): Promise<void> {
  await refreshOutputMessage(bot, store, topic, "ACTIVE");
  await refreshOutputMessage(bot, store, topic, "ARCHIVE");
}

async function refreshOutputMessage(bot: Bot, store: HomeworkStore, topic: Topic, messageType: PersistentMessageType): Promise<void> {
  const lockKey = messageType;
  const previous = refreshLocks.get(lockKey) ?? Promise.resolve();
  const next = previous.then(async () => {
    await store.withPersistentMessageLock(topic.chatId, topic.threadId, messageType, async (messageId, setMessageId) => {
      // Read the homework list only after acquiring the global output lock.
      // This prevents an older refresh from overwriting a newer list when
      // /add is executed from different source Topics concurrently.
      const data = await store.getTopicMessages(topic.chatId, topic.threadId);
      const text = formatPersistentMessages(data)[messageType === "ACTIVE" ? "active" : "archive"];
      const saved = await store.getPersistentMessageInfo(topic.chatId, topic.threadId, messageType);
      if (!saved || saved.destinationChatId === null) return;
      const destinationChatId = saved.destinationChatId;

      if (messageId) {
        try {
          await bot.api.editMessageText(destinationChatId, messageId, text, { parse_mode: "HTML" });
          return;
        } catch (error) {
          // Telegram returns MESSAGE_NOT_MODIFIED when the persistent message
          // already contains exactly this text. That is a successful refresh,
          // not a reason to create a second message.
          if (isMessageNotModifiedError(error)) return;
          console.warn(`Could not edit ${messageType} output message:`, error);
        }
      }

      const options: { parse_mode: "HTML"; message_thread_id?: number } = { parse_mode: "HTML" };
      if (saved.destinationThreadId !== null && saved.destinationThreadId > 0) options.message_thread_id = saved.destinationThreadId;
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
  try {
    await next;
  } finally {
    if (refreshLocks.get(lockKey) === next) refreshLocks.delete(lockKey);
  }
}

function isMessageNotModifiedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const description = "description" in error && typeof error.description === "string" ? error.description : "";
  return description.includes("MESSAGE_NOT_MODIFIED");
}
