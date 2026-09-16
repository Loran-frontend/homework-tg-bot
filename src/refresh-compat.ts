import { Bot } from "grammy";
import { HomeworkStore } from "./store.js";
import { formatPersistentMessages } from "./format.js";
import type { PersistentMessageType } from "./types.js";

type Topic = { chatId: number; threadId: number };

export async function refreshMessage(bot: Bot, store: HomeworkStore, topic: Topic): Promise<void> {
  await refreshOutputMessage(bot, store, topic, "ACTIVE");
  await refreshOutputMessage(bot, store, topic, "ARCHIVE");
}

async function refreshOutputMessage(bot: Bot, store: HomeworkStore, topic: Topic, messageType: PersistentMessageType): Promise<void> {
  const data = await store.getOutputMessages();
  const text = formatPersistentMessages(data)[messageType === "ACTIVE" ? "active" : "archive"];

  await store.withOutputMessageLock(messageType, async (messageId, savedDestinationChatId, setMessage) => {
    const targetChatId = savedDestinationChatId ?? topic.chatId;

    if (messageId && savedDestinationChatId !== null) {
      try {
        await bot.api.editMessageText(savedDestinationChatId, messageId, text, { parse_mode: "HTML" });
        return;
      } catch (error) {
        console.warn(`Could not edit ${messageType} output message:`, error);
      }
    }

    const options = savedDestinationChatId === targetChatId
      ? { message_thread_id: topic.threadId, parse_mode: "HTML" as const }
      : { parse_mode: "HTML" as const };

    const message = await bot.api.sendMessage(targetChatId, text, options);
    await setMessage(message.message_id);

    try {
      await bot.api.pinChatMessage(targetChatId, message.message_id, { disable_notification: true });
    } catch (error) {
      console.warn(`Could not pin ${messageType} output message:`, error);
    }
  });
}
