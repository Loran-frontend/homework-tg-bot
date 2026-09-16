import { Bot, InlineKeyboard, type Context } from "grammy";
import { HomeworkStore } from "./store.js";
import { formatHomework, formatPersistentMessages, IRNITU_SUBJECTS, MIPT_SUBJECTS, isValidSubject, subgroupLabel } from "./format.js";
import type { HomeworkSubgroup, HomeworkType, PersistentMessageType } from "./types.js";

type Topic = { chatId: number; threadId: number };
type CommandContext = { topic: Topic; userId: number };
type AddState = { topic: Topic; userId: number; type?: HomeworkType; subject?: string; subgroup?: HomeworkSubgroup; deadline?: Date };

const COMMAND_HELP = [
  "Команды:",
  "/add <текст> | <ДД.ММ.ГГГГ ЧЧ:ММ> — добавить ДЗ с дедлайном",
  "/edit <номер> <текст> — изменить ДЗ",
  "/delete <номер> — удалить ДЗ",
  "/list — показать ДЗ с учетом вашей подгруппы",
  "/done <номер> — отметить ДЗ выполненным",
  "/group — выбрать свою подгруппу",
].join("\n");

const refreshLocks = new Map<string, Promise<void>>();
const addStates = new Map<string, AddState>();

export function createBot(token: string, store: HomeworkStore): Bot {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => runCommand(ctx, async () => {
    const topic = getTopic(ctx);
    await refreshPersistentMessages(ctx, store, topic);
    await replyInTopic(ctx, `Бот для домашних заданий готов.\n\n${COMMAND_HELP}`, topic);
  }));
  bot.command("help", async (ctx) => runCommand(ctx, async () => replyInTopic(ctx, COMMAND_HELP)));

  bot.command("add", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const parsed = parseAddCommand(ctx.match);
    if (!parsed) {
      await replyInTopic(ctx, "Использование: /add <текст ДЗ> | <ДД.ММ.ГГГГ ЧЧ:ММ>\nНапример: /add Решить задачи 1-10 | 25.09.2026 23:59", command.topic);
      return;
    }
    addStates.set(stateKey(command.topic, command.userId), { topic: command.topic, userId: command.userId });
    await ctx.reply("Выберите тип ДЗ:", { reply_markup: new InlineKeyboard().text("📚 ИРНИТУ", "add:type:IRNITU").text("📘 МФТИ", "add:type:MIPT") });
  }));

    await store.add(command.topic.chatId, command.topic.threadId, parsed.text, {
      telegramId: command.userId,
      username: ctx.from?.username,
      firstName: ctx.from?.first_name,
      lastName: ctx.from?.last_name,
    }, parsed.deadline);
    await refreshMessage(ctx.api, store, command.topic);
  }));

  bot.callbackQuery(/^add:subject:(.+)$/, async (ctx) => runCommand(ctx, async () => {
    const state = getAddState(ctx);
    if (!state.type) throw new Error("Сначала выберите тип ДЗ.");
    const subject = decodeURIComponent(ctx.callbackQuery.data.slice("add:subject:".length));
    if (!isValidSubject(state.type, subject)) throw new Error("Недопустимый предмет для выбранного типа ДЗ.");
    state.subject = subject;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Для кого это ДЗ?", { reply_markup: subgroupKeyboard("add:subgroup:") });
  }));

  bot.callbackQuery(/^add:subgroup:(ALL|GROUP_1|GROUP_2)$/, async (ctx) => runCommand(ctx, async () => {
    const state = getAddState(ctx);
    const subgroup = ctx.callbackQuery.data.split(":")[2] as HomeworkSubgroup;
    if (!state.type || !state.subject) throw new Error("Сначала выберите тип и предмет.");
    state.subgroup = subgroup;
    state.deadline = undefined;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Введите срок в формате ДД.ММ.ГГГГ ЧЧ:ММ, например 25.09.2026 23:59.");
  }));

  bot.command("group", async (ctx) => runCommand(ctx, async () => {
    getCommandContext(ctx);
    await ctx.reply("Выберите свою подгруппу:", { reply_markup: subgroupKeyboard("group:") });
  }));

  bot.callbackQuery(/^group:(ALL|GROUP_1|GROUP_2)$/, async (ctx) => runCommand(ctx, async () => {
    const command = getCallbackContext(ctx);
    const subgroup = ctx.callbackQuery.data.split(":")[1] as HomeworkSubgroup;
    await store.setUserSubgroup(command.userId, subgroup, userInput(ctx));
    await ctx.answerCallbackQuery("Подгруппа сохранена");
    await ctx.editMessageText(`Подгруппа: ${subgroupLabel(subgroup)}`);
  }));

  bot.on("message:text", async (ctx, next) => {
    const userId = getUserId(ctx);
    const message = ctx.msg;
    const topic = message.chat.type === "supergroup" && message.is_topic_message && message.message_thread_id !== undefined
      ? { chatId: message.chat.id, threadId: message.message_thread_id }
      : null;
    if (!topic) return next();
    const state = addStates.get(stateKey(topic, userId));
    if (!state || !state.type || !state.subject || !state.subgroup) return next();

    await runCommand(ctx, async () => {
      if (!state.deadline) {
        const deadline = parseDeadline(ctx.message.text);
        if (!deadline) {
          await replyInTopic(ctx, "Неверный срок. Используйте ДД.ММ.ГГГГ ЧЧ:ММ, например 25.09.2026 23:59.", topic);
          return;
        }
        state.deadline = deadline;
        await replyInTopic(ctx, "Теперь отправьте текст задания одним сообщением.", topic);
        return;
      }
      const description = ctx.message.text.trim();
      if (!description) {
        await replyInTopic(ctx, "Текст задания не может быть пустым.", topic);
        return;
      }
      await store.add(topic.chatId, topic.threadId, {
        type: state.type,
        subject: state.subject,
        description,
        subgroup: state.subgroup,
        deadline: state.deadline,
      }, userInput(ctx));
      addStates.delete(stateKey(topic, userId));
      await refreshPersistentMessages(ctx, store, topic);
    });
  });

  bot.command("edit", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const parsed = parseEditCommand(ctx.match);
    if (!parsed) {
      await replyInTopic(ctx, "Использование: /edit <номер> <новое описание>", command.topic);
      return;
    }
    const result = await store.edit(command.topic.chatId, command.topic.threadId, parsed.id, parsed.text);
    if (!result) {
      await replyInTopic(ctx, "ДЗ с таким номером не найдено в этом topic.", command.topic);
      return;
    }
    await refreshMessage(ctx.api, store, command.topic);
  }));

  bot.command("delete", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const id = parseId(ctx.match);
    if (id === null || ctx.match.trim() !== String(id)) {
      await replyInTopic(ctx, "Использование: /delete <номер>", command.topic);
      return;
    }
    const result = await store.remove(command.topic.chatId, command.topic.threadId, id);
    if (!result.removed) {
      await replyInTopic(ctx, "ДЗ с таким номером не найдено в этом topic.", command.topic);
      return;
    }
    await refreshMessage(ctx.api, store, command.topic);
  }));

  bot.command("list", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    if (ctx.match.trim()) {
      await replyInTopic(ctx, "Использование: /list", command.topic);
      return;
    }
    await refreshMessage(ctx.api, store, command.topic);
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
    await refreshMessage(ctx.api, store, command.topic);
  }));

  return bot;
}

async function refreshPersistentMessages(ctx: Context, store: HomeworkStore, topic: Topic): Promise<void> {
  const data = await store.getTopicMessages(topic.chatId, topic.threadId);
  const text = formatPersistentMessages(data);
  await refreshPersistentMessage(ctx, store, topic, "ACTIVE", text.active, data.activeMessageId);
  await refreshPersistentMessage(ctx, store, topic, "ARCHIVE", text.archive, data.archiveMessageId);
}

async function refreshPersistentMessage(ctx: Context, store: HomeworkStore, topic: Topic, messageType: PersistentMessageType, text: string, knownMessageId?: number): Promise<void> {
  const key = `${topic.chatId}:${topic.threadId}:${messageType}`;
  const previous = refreshLocks.get(key) ?? Promise.resolve();
  const current = previous.then(async () => {
    await store.withPersistentMessageLock(topic.chatId, topic.threadId, messageType, async (savedMessageId, setMessageId) => {
      const messageId = savedMessageId ?? knownMessageId;
      if (messageId) {
        try {
          await ctx.api.editMessageText(topic.chatId, messageId, text, { parse_mode: "HTML" });
          return;
        } catch (error) {
          const description = getTelegramErrorDescription(error).toLowerCase();
          if (description.includes("message is not modified")) return;
          if (!isMissingMessageError(error)) throw error;
        }
      }

      const message = await ctx.api.sendMessage(topic.chatId, text, {
        message_thread_id: topic.threadId,
        parse_mode: "HTML",
      });
      await setMessageId(message.message_id);
      await ctx.api.pinChatMessage(topic.chatId, message.message_id, { disable_notification: true });
    });
  });
  refreshLocks.set(key, current);
  try {
    await current;
  } finally {
    if (refreshLocks.get(key) === current) refreshLocks.delete(key);
  }
}

function subgroupKeyboard(prefix: string): InlineKeyboard {
  return new InlineKeyboard().text("Все", `${prefix}ALL`).text("1 подгруппа", `${prefix}GROUP_1`).text("2 подгруппа", `${prefix}GROUP_2`);
}

function stateKey(topic: Topic, userId: number): string { return `${topic.chatId}:${topic.threadId}:${userId}`; }

function getAddState(ctx: Context): AddState {
  const command = getCallbackContext(ctx);
  const state = addStates.get(stateKey(command.topic, command.userId));
  if (!state) throw new Error("Сессия добавления ДЗ истекла. Запустите /add снова.");
  return state;
}

function getCallbackContext(ctx: Context): CommandContext {
  const message = ctx.callbackQuery.message;
  if (!message || message.chat.type !== "supergroup" || !("message_thread_id" in message) || message.message_thread_id === undefined) {
    throw new Error("Выбор должен выполняться внутри Topic.");
  }
  return { topic: { chatId: message.chat.id, threadId: message.message_thread_id }, userId: getUserId(ctx) };
}

function getCommandContext(ctx: Context): CommandContext { return { topic: getTopic(ctx), userId: getUserId(ctx) }; }

function getTopic(ctx: Context): Topic {
  const message = ctx.msg;
  if (!message?.chat) throw new Error("Команда должна быть отправлена из сообщения чата.");
  if (message.chat.type !== "supergroup") throw new Error("Команды доступны только в Telegram supergroup с Topics.");
  if (!message.is_topic_message || message.message_thread_id === undefined) throw new Error("Команда должна быть отправлена внутри Telegram Topic.");
  return { chatId: message.chat.id, threadId: message.message_thread_id };
}

function getUserId(ctx: Context): number {
  if (!ctx.from) throw new Error("Не удалось определить пользователя Telegram.");
  return ctx.from.id;
}

function userInput(ctx: Context) {
  return { telegramId: getUserId(ctx), username: ctx.from?.username, firstName: ctx.from?.first_name, lastName: ctx.from?.last_name };
}

async function runCommand(ctx: Context, handler: () => Promise<void>): Promise<void> {
  try { await handler(); } catch (error) { console.error("Telegram command error:", error); await replyError(ctx, error); }
}

async function replyError(ctx: Context, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  let text = "Не удалось выполнить команду.";
  if (message.includes("Topic") || message.includes("supergroup") || message.includes("сообщения чата")) text = message;
  else if (message.includes("Prisma") || message.includes("database") || message.includes("Database")) text = "Произошла ошибка базы данных. Попробуйте ещё раз позже.";
  else if (message.includes("Telegram")) text = "Не удалось выполнить операцию в Telegram. Проверьте права бота и попробуйте ещё раз.";
  try {
    const source = ctx.msg;
    if (source?.chat && source.is_topic_message && source.message_thread_id !== undefined) await ctx.api.sendMessage(source.chat.id, text, { message_thread_id: source.message_thread_id });
    else if (source?.chat) await ctx.api.sendMessage(source.chat.id, text);
    else if (ctx.callbackQuery?.message) await ctx.api.sendMessage(ctx.callbackQuery.message.chat.id, text);
  } catch (telegramError) { console.error("Failed to send command error to Telegram:", telegramError); }
}

async function replyInTopic(ctx: Context, text: string, topic?: Topic): Promise<void> {
  const target = topic ?? getTopic(ctx);
  await ctx.api.sendMessage(target.chatId, text, { message_thread_id: target.threadId });
}

export async function refreshMessage(api: Context["api"], store: HomeworkStore, topic: Topic): Promise<void> {
  const key = `${topic.chatId}:${topic.threadId}`;
  const previous = refreshLocks.get(key) ?? Promise.resolve();
  const current = previous.then(() => refreshMessageUnsafe(api, store, topic));
  refreshLocks.set(key, current);
  try {
    await current;
  } finally {
    if (refreshLocks.get(key) === current) refreshLocks.delete(key);
  }
}

async function refreshMessageUnsafe(api: Context["api"], store: HomeworkStore, topic: Topic): Promise<void> {
  const data = await store.getTopic(topic.chatId, topic.threadId);
  const text = formatHomework(data);

  if (data.messageId) {
    try {
      await api.editMessageText(topic.chatId, data.messageId, text, { parse_mode: "HTML" });
      return;
    } catch (error) {
      const description = getTelegramErrorDescription(error);
      if (description.includes("message is not modified")) return;
      if (!isMissingMessageError(error)) throw error;
      // The stored primary message no longer exists. Clear the stale id before recreating it.
      await store.setMessageId(topic.chatId, topic.threadId, null);
    }
  }

  const message = await api.sendMessage(topic.chatId, text, {
    message_thread_id: topic.threadId,
    parse_mode: "HTML",
  });
  await store.setMessageId(topic.chatId, topic.threadId, message.message_id);
}

function getTelegramErrorDescription(error: unknown): string {
  if (typeof error === "object" && error !== null && "description" in error) {
    const description = (error as { description?: unknown }).description;
    if (typeof description === "string") return description;
  }
  return error instanceof Error ? error.message : String(error);
}

export function isMissingMessageError(error: unknown): boolean {
  const description = getTelegramErrorDescription(error).toLowerCase();
  return description.includes("message to edit not found") || description.includes("message can't be edited") || description.includes("message to delete not found");
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

export function parseAddCommand(value: string): { text: string; deadline?: Date } | null {
  const input = value.trim();
  if (!input) return null;

  const separator = input.lastIndexOf("|");
  if (separator === -1) return { text: input };

  const text = input.slice(0, separator).trim();
  const deadlineText = input.slice(separator + 1).trim();
  if (!text || !deadlineText) return null;

  const deadline = parseDeadline(deadlineText);
  if (!deadline) return null;
  return { text, deadline };
}

export function parseDeadline(value: string): Date | null {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, day, month, year, hours, minutes] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes)));
  if (date.getUTCFullYear() !== Number(year) ||
      date.getUTCMonth() !== Number(month) - 1 ||
      date.getUTCDate() !== Number(day) ||
      date.getUTCHours() !== Number(hours) ||
      date.getUTCMinutes() !== Number(minutes)) {
    return null;
  }
  return date;
}
