import { Bot } from "grammy";
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
    await ctx.reply(`Бот для домашних заданий готов.\n\n${COMMAND_HELP}`);
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(COMMAND_HELP);
  });

  bot.command("add", async (ctx) => {
    const text = ctx.match.trim();
    if (!text) {
      await ctx.reply("Использование: /add <текст ДЗ>");
      return;
    }

    const topic = getTopic(ctx);
    await store.add(topic.chatId, topic.threadId, text);
    await refreshMessage(ctx, store);
    await ctx.reply("ДЗ добавлено.");
  });

  bot.command("edit", async (ctx) => {
    const match = ctx.match.trim().match(/^(\d+)\s+(.+)$/s);
    if (!match) {
      await ctx.reply("Использование: /edit <номер> <новый текст>");
      return;
    }

    const topic = getTopic(ctx);
    const item = await store.edit(topic.chatId, topic.threadId, Number(match[1]), match[2].trim());
    if (!item) {
      await ctx.reply("ДЗ с таким номером не найдено.");
      return;
    }

    await refreshMessage(ctx, store);
    await ctx.reply("ДЗ изменено.");
  });

  bot.command("delete", async (ctx) => {
    const id = parseId(ctx.match);
    if (id === null) {
      await ctx.reply("Использование: /delete <номер>");
      return;
    }

    const topic = getTopic(ctx);
    if (!(await store.remove(topic.chatId, topic.threadId, id))) {
      await ctx.reply("ДЗ с таким номером не найдено.");
      return;
    }

    await refreshMessage(ctx, store);
    await ctx.reply("ДЗ удалено.");
  });

  bot.command("list", async (ctx) => {
    await refreshMessage(ctx, store);
  });

  bot.command("done", async (ctx) => {
    const id = parseId(ctx.match);
    if (id === null) {
      await ctx.reply("Использование: /done <номер>");
      return;
    }

    const topic = getTopic(ctx);
    const item = await store.toggleDone(topic.chatId, topic.threadId, id);
    if (!item) {
      await ctx.reply("ДЗ с таким номером не найдено.");
      return;
    }

    await refreshMessage(ctx, store);
    await ctx.reply(item.completed ? "ДЗ отмечено выполненным." : "Отметка о выполнении снята.");
  });

  return bot;
}

function getTopic(ctx: { chat?: { id: number }; message?: { message_thread_id?: number } }) {
  if (!ctx.chat) throw new Error("Команда должна быть отправлена из чата.");
  return {
    chatId: ctx.chat.id,
    threadId: ctx.message?.message_thread_id ?? 0,
  };
}

async function refreshMessage(ctx: any, store: HomeworkStore): Promise<void> {
  const topic = getTopic(ctx);
  const data = store.getTopic(topic.chatId, topic.threadId);
  const text = formatHomework(data);

  if (data.messageId) {
    try {
      await ctx.api.editMessageText(topic.chatId, data.messageId, text, { parse_mode: "HTML" });
      return;
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      if (!description.includes("message is not modified")) {
        data.messageId = undefined;
      } else {
        return;
      }
    }
  }

  const message = await ctx.reply(text, { parse_mode: "HTML" });
  await store.setMessageId(topic.chatId, topic.threadId, message.message_id);
}

function parseId(value: string): number | null {
  const id = Number(value.trim());
  return Number.isInteger(id) && id > 0 ? id : null;
}
