import { Bot, type Context } from "grammy";
import { HomeworkStore } from "./store.js";
import { formatHomework } from "./format.js";

const COMMAND_HELP = [
  "Команды:",
  "/add <текст> — добавить ДЗ",
  "/edit <номер> <текст> — изменить ДЗ",
  "/delete <номер> — удалить ДЗ",
  "/list — показать список",
  "/done <номер> — отметить ДЗ выполненным",
].join("\n");

const refreshLocks = new Map<string, Promise<void>>();

export function createBot(token: string, store: HomeworkStore): Bot {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => runCommand(ctx, async () => replyInTopic(ctx, `Бот для домашних заданий готов.\n\n${COMMAND_HELP}`)));
  bot.command("help", async (ctx) => runCommand(ctx, async () => replyInTopic(ctx, COMMAND_HELP)));

  bot.command("add", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const text = ctx.match.trim();
    if (!text) {
      await replyInTopic(ctx, "Использование: /add <текст ДЗ>", command.topic);
      return;
    }

    await store.add(command.topic.chatId, command.topic.threadId, text, {
      telegramId: command.userId,
      username: ctx.from?.username,
      firstName: ctx.from?.first_name,
      lastName: ctx.from?.last_name,
    });
    await refreshMessage(ctx, store, command.topic);
  }));

  bot.command("edit", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const parsed = parseEditCommand(ctx.match);
    if (!parsed) {
      await replyInTopic(ctx, "Использование: /edit <номер> <новый текст>", command.topic);
      return;
    }

    const item = await store.edit(command.topic.chatId, command.topic.threadId, parsed.id, parsed.text);
    if (!item) {
      await replyInTopic(ctx, "ДЗ с таким номером не найдено в этом topic.", command.topic);
      return;
    }
    await refreshMessage(ctx, store, command.topic);
  }));

  bot.command("delete", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const id = parseId(ctx.match);
    if (id === null || ctx.match.trim() !== String(id)) {
      await replyInTopic(ctx, "Использование: /delete <номер>", command.topic);
      return;
    }

    if (!(await store.remove(command.topic.chatId, command.topic.threadId, id))) {
      await replyInTopic(ctx, "ДЗ с таким номером не найдено в этом topic.", command.topic);
      return;
    }
    await refreshMessage(ctx, store, command.topic);
  }));

  bot.command("list", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    if (ctx.match.trim()) {
      await replyInTopic(ctx, "Использование: /list", command.topic);
      return;
    }
    await refreshMessage(ctx, store, command.topic);
  }));

  bot.command("done", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const id = parseId(ctx.match);
    if (id === null || ctx.match.trim() !== String(id)) {
      await replyInTopic(ctx, "Использование: /done <номер>", command.topic);
      return;
    }

    const result = await store.markDone(command.topic.chatId, command.topic.threadId, id);
    if (!result) {
      await replyInTopic(ctx, "ДЗ с таким номером не найдено в этом topic.", command.topic);
      return;
    }
    if (result.alreadyDone) {
      await replyInTopic(ctx, "Это ДЗ уже отмечено как выполненное.", command.topic);
      return;
    }
    await refreshMessage(ctx, store, command.topic);
  }));

  return bot;
}

type Topic = { chatId: number; threadId: number };
type CommandContext = { topic: Topic; userId: number };

function getCommandContext(ctx: Context): CommandContext {
  return { topic: getTopic(ctx), userId: getUserId(ctx) };
}

function getTopic(ctx: Context): Topic {
  const message = ctx.msg;
  if (!message?.chat) throw new Error("Команда должна быть отправлена из сообщения чата.");
  if (message.chat.type !== "supergroup") throw new Error("Команды доступны только в Telegram supergroup с Topics.");
  if (!message.is_topic_message || message.message_thread_id === undefined) {
    throw new Error("Команда должна быть отправлена внутри Telegram Topic.");
  }
  return { chatId: message.chat.id, threadId: message.message_thread_id };
}

function getUserId(ctx: Context): number {
  if (!ctx.from) throw new Error("Не удалось определить пользователя Telegram.");
  return ctx.from.id;
}

async function runCommand(ctx: Context, handler: () => Promise<void>): Promise<void> {
  try {
    await handler();
  } catch (error) {
    console.error("Telegram command error:", error);
    await replyError(ctx, error);
  }
}

async function replyError(ctx: Context, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  let text = "Не удалось выполнить команду.";
  if (message.includes("Topic") || message.includes("supergroup") || message.includes("сообщения чата")) {
    text = message;
  } else if (message.includes("Prisma") || message.includes("database") || message.includes("Database")) {
    text = "Произошла ошибка базы данных. Попробуйте ещё раз позже.";
  } else if (message.includes("Telegram")) {
    text = "Не удалось выполнить операцию в Telegram. Проверьте права бота и попробуйте ещё раз.";
  }

  try {
    const source = ctx.msg;
    if (!source?.chat) return;
    if (source.is_topic_message && source.message_thread_id !== undefined) {
      await ctx.api.sendMessage(source.chat.id, text, { message_thread_id: source.message_thread_id });
    } else {
      await ctx.api.sendMessage(source.chat.id, text);
    }
  } catch (telegramError) {
    console.error("Failed to send command error to Telegram:", telegramError);
  }
}

async function replyInTopic(ctx: Context, text: string, topic?: Topic): Promise<void> {
  const target = topic ?? getTopic(ctx);
  await ctx.api.sendMessage(target.chatId, text, { message_thread_id: target.threadId });
}

async function refreshMessage(ctx: Context, store: HomeworkStore, topic: Topic): Promise<void> {
  const key = `${topic.chatId}:${topic.threadId}`;
  const previous = refreshLocks.get(key) ?? Promise.resolve();
  const current = previous.then(() => refreshMessageUnsafe(ctx, store, topic));
  refreshLocks.set(key, current);
  try {
    await current;
  } finally {
    if (refreshLocks.get(key) === current) refreshLocks.delete(key);
  }
}

async function refreshMessageUnsafe(ctx: Context, store: HomeworkStore, topic: Topic): Promise<void> {
  const data = await store.getTopic(topic.chatId, topic.threadId);
  const text = formatHomework(data);

  if (data.messageId) {
    try {
      await ctx.api.editMessageText(topic.chatId, data.messageId, text, { parse_mode: "HTML" });
      return;
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      if (description.includes("message is not modified")) return;
      if (!isMissingMessageError(description)) throw error;
      await store.setMessageId(topic.chatId, topic.threadId, null);
    }
  }

  const message = await ctx.api.sendMessage(topic.chatId, text, {
    message_thread_id: topic.threadId,
    parse_mode: "HTML",
  });
  await store.setMessageId(topic.chatId, topic.threadId, message.message_id);
}

function isMissingMessageError(description: string): boolean {
  return description.includes("message to edit not found") || description.includes("message can't be edited");
}

export function parseId(value: string): number | null {
  const id = Number(value.trim());
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function parseEditCommand(value: string): { id: number; text: string } | null {
  const match = value.trim().match(/^(\d+)\s+(.+)$/s);
  if (!match) return null;
  const id = parseId(match[1]);
  const text = match[2].trim();
  if (id === null || !text) return null;
  return { id, text };
}
