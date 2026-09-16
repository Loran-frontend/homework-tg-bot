import type { Bot } from "grammy";
import { HomeworkStore } from "./store.js";
import type { PersistentMessageType } from "./types.js";

const OUTPUT_TITLES: Array<[string, PersistentMessageType]> = [
  ["📚 <b>Актуальные ДЗ</b>", "ACTIVE"],
  ["🗄 <b>Архив ДЗ</b>", "ARCHIVE"],
];

export function installOutputTopicRouter(bot: Bot, store: HomeworkStore): void {
  const api = bot.api as any;
  const originalSendMessage = api.sendMessage.bind(api);

  api.sendMessage = async (chatId: number | string, text: string, other?: Record<string, unknown>, ...rest: unknown[]) => {
    let options = other ? { ...other } : {};
    const outputType = detectOutputType(text);

    if (outputType) {
      const destinationChatId = Number(chatId);
      const savedThreadId = await store.getOutputDestinationThread(outputType);

      // If the global output message is recreated, always use the persisted Topic.
      // This prevents a refresh triggered from another Topic from recreating it in General.
      if (savedThreadId !== null && options.message_thread_id === undefined) {
        options.message_thread_id = savedThreadId;
      }

      // Remember the Topic used for the first creation (/setactive here or /setarchive here).
      if (options.message_thread_id !== undefined && destinationChatId !== 0) {
        const threadId = Number(options.message_thread_id);
        if (Number.isInteger(threadId) && threadId >= 0) {
          await store.setOutputDestinationWithThread(outputType, destinationChatId, threadId);
        }
      }
    }

    return originalSendMessage(chatId, text, options, ...rest);
  };
}

function detectOutputType(text: string): PersistentMessageType | null {
  for (const [title, type] of OUTPUT_TITLES) {
    if (text.startsWith(title)) return type;
  }
  return null;
}
