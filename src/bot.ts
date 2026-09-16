import { Bot, type Context } from "grammy";
import { HomeworkStore } from "./store.js";
import { formatHomework } from "./format.js";

const COMMAND_HELP = [
  "Команды:",
  "/add <текст> — добавить ДЗ",
  "/edit <номер> <текст> — изменить ДЗ",
  "/delete <номер> — удалить ДЗ",
  "/list — показать список",
  "/done <номер> — отметить/снять выполнение",
].join("\n");

export function createBot(token: string, store: HomeworkStore): Bot {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    await replyInTopic(ctx, `Бот для домашних заданий готов.\n\n${COMMAND_HELP}`);
  });

  bot.command("help", async (ctx) => {
    await replyInTopic(ctx, COMMAND_HELP);
  });

  bot.command("add", async (ctx) => {
    const topic = getTopic(ctx);
    const text = ctx.match.trim();
    if (!text) {
      await replyInTopic(ctx, "Использование: /add <текст ДЗ>", topic);
      return;
    }

    const user = ctx.from;
    if (!user) throw new Error("Не удалось определить автора команды.");

    await store.add(topic.chatId, topic.threadId, text, {
      telegramId: user.id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
    });
    await refreshMessage(ctx, store, topic);
  });

  bot.command("edit", async (ctx) => {
    const topic = getTopic(ctx);
    const match = ctx.match.trim().match(/^(\d+)\s+(.+)$/s);
    if (!match) {
      await replyInTopic(ctx, "Использование: /edit <номер> <новый текст>", topic);
      return;
    }

    const item = await store.edit(topic.chatId, topic.threadId, Number(match[1]), match[2].trim());
    if (!item) {
      await replyInTopic(ctx, "ДЗ с таким номером не найдено.", topic);
      return;
    }

    await refreshMessage(ctx, store, topic);
  });

  bot.command("delete", async (ctx) => {
    const topic = getTopic(ctx);
    const id = parseId(ctx.match);
    if (id === null) {
      await replyInTopic(ctx, "Использование: /delete <номер>", topic);
      return;
    }

    if (!(await store.remove(topic.chatId, topic.threadId, id))) {
      await replyInTopic(ctx, "ДЗ с таким номером не найдено.", topic);
      return;
    }

    await refreshMessage(ctx, store, topic);
  });

  bot.command("list", async (ctx) => {
    const topic = getTopic(ctx);
    await refreshMessage(ctx, store, topic);
  });

  bot.command("done", async (ctx) => {
    const topic = getTopic(ctx);
    const id = parseId(ctx.match);
    if (id === null) {
      await replyInTopic(ctx, "Использование: /done <номер>", topic);
      return;
    }

    const item = await store.toggleDone(topic.chatId, topic.threadId, id);
    if (!item) {
      await replyInTopic(ctx, "ДЗ с таким номером не найдено.", topic);
      return;
    }

    await refreshMessage(ctx, store, topic);
  });

  return bot;
}

type Topic = {
  chatId: number;
  threadId: number;
};

function getTopic(ctx: Context): Topic {
  const message = ctx.msg;
  if (!message?.chat) throw new Error("Команда должна быть отправлена из сообщения чата.");
  if (message.chat.type !== "supergroup") throw new Error("Бот работает только в Telegram supergroup с Topics.");
  if (!message.is_topic_message || message.message_thread_id === undefined) {
    throw new Error("Команда должна быть отправлена внутри Telegram Topic.");
  }

  return { chatId: message.chat.id, threadId: message.message_thread_id };
}

async function replyInTopic(ctx: Context, text: string, topic?: Topic): Promise<void> {
  const target = topic ?? getTopic(ctx);
  await ctx.api.sendMessage(target.chatId, text, { message_thread_id: target.threadId });
}

async function refreshMessage(ctx: Context, store: HomeworkStore, topic: Topic): Promise<void> {
  const data = await store.getTopic(topic.chatId, topic.threadId);
  const text = formatHomework(data);

  if (data.messageId) {
    try {
      await ctx.api.editMessageText(topic.chatId, data.messageId, text, { parse_mode: "HTML" });
      return;
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      if (description.includes("message is not modified")) return;
      await store.setMessageId(topic.chatId, topic.threadId, null);
    }
  }

  const message = await ctx.api.sendMessage(topic.chatId, text, {
    message_thread_id: topic.threadId,
    parse_mode: "HTML",
  });
  await store.setMessageId(topic.chatId, topic.threadId, message.message_id);
}

function parseId(value: string): number | null {
  const id = Number(value.trim());
  return Number.isInteger(id) && id > 0 ? id : null;
}
