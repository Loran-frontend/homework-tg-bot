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
    // Не создаём сообщение для типа, который ещё не настроен.
    if (savedDestinationChatId === null) return;

    if (messageId) {
      try {
        await bot.api.editMessageText(savedDestinationChatId, messageId, text, { parse_mode: "HTML" });
        return;
      } catch (error) {
        console.warn(`Could not edit ${messageType} output message:`, error);
      }
    }

    const message = await bot.api.sendMessage(savedDestinationChatId, text, { parse_mode: "HTML" });
    await setMessage(message.message_id);

    try {
      await bot.api.pinChatMessage(savedDestinationChatId, message.message_id, { disable_notification: true });
    } catch (error) {
      console.warn(`Could not pin ${messageType} output message:`, error);
    }
  });
}
