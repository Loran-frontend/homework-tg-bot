import { Bot, InlineKeyboard, type Context } from "grammy";
import { HomeworkStore } from "./store.js";
import { formatPersistentMessages, IRNITU_SUBJECTS, MIPT_SUBJECTS, isValidSubject, subgroupLabel } from "./format.js";
import type { HomeworkSubgroup, HomeworkType, PersistentMessageType } from "./types.js";

type Topic = { chatId: number; threadId: number };
type CommandContext = { topic: Topic; userId: number };
type AddState = { topic: Topic; userId: number; type?: HomeworkType; subject?: string; subgroup?: HomeworkSubgroup; deadline?: Date };

const COMMAND_HELP = [
  "Команды:",
  "/add — добавить ДЗ",
  "/edit <номер> <текст> — изменить ДЗ",
  "/delete <номер> — удалить ДЗ",
  "/list — обновить список ДЗ",
  "/done <номер> — отметить ДЗ выполненным",
  "/group — выбрать подгруппу",
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
    addStates.set(stateKey(command.topic, command.userId), { topic: command.topic, userId: command.userId });
    await ctx.reply("Выберите тип ДЗ:", { reply_markup: new InlineKeyboard().text("📚 ИРНИТУ", "add:type:IRNITU").text("📘 МФТИ", "add:type:MIPT") });
  }));

  bot.callbackQuery(/^add:type:(IRNITU|MIPT)$/, async (ctx) => runCommand(ctx, async () => {
    const state = getAddState(ctx);
    const data = getCallbackData(ctx);
    const selectedType = data.split(":")[2];
    if (selectedType !== "IRNITU" && selectedType !== "MIPT") throw new Error("Недопустимый тип ДЗ.");
    state.type = selectedType;
    const subjects = state.type === "IRNITU" ? IRNITU_SUBJECTS : MIPT_SUBJECTS;
    const keyboard = new InlineKeyboard();
    for (let index = 0; index < subjects.length; index += 1) {
      keyboard.text(subjects[index], `add:subject:${index}`).row();
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Выберите предмет:", { reply_markup: keyboard });
  }));

  bot.callbackQuery(/^add:subject:(\d+)$/, async (ctx) => runCommand(ctx, async () => {
    const state = getAddState(ctx);
    if (!state.type) throw new Error("Сначала выберите тип ДЗ.");
    const data = getCallbackData(ctx);
    const index = Number(data.slice("add:subject:".length));
    const subjects = state.type === "IRNITU" ? IRNITU_SUBJECTS : MIPT_SUBJECTS;
    const subject = subjects[index];
    if (!subject || !isValidSubject(state.type, subject)) throw new Error("Недопустимый предмет.");
    state.subject = subject;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Для кого это ДЗ?", { reply_markup: subgroupKeyboard("add:subgroup:") });
  }));

  bot.callbackQuery(/^add:subgroup:(ALL|GROUP_1|GROUP_2)$/, async (ctx) => runCommand(ctx, async () => {
    const state = getAddState(ctx);
    if (!state.type || !state.subject) throw new Error("Сначала выберите тип и предмет.");
    const data = getCallbackData(ctx);
    const subgroup = data.split(":")[2];
    if (subgroup !== "ALL" && subgroup !== "GROUP_1" && subgroup !== "GROUP_2") throw new Error("Недопустимая подгруппа.");
    state.subgroup = subgroup;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Введите срок: ДД.ММ.ГГГГ ЧЧ:ММ");
  }));

  bot.command("group", async (ctx) => runCommand(ctx, async () => {
    getCommandContext(ctx);
    await ctx.reply("Выберите свою подгруппу:", { reply_markup: subgroupKeyboard("group:") });
  }));

  bot.callbackQuery(/^group:(ALL|GROUP_1|GROUP_2)$/, async (ctx) => runCommand(ctx, async () => {
    const command = getCallbackContext(ctx);
    const data = getCallbackData(ctx);
    const subgroup = data.split(":")[1];
    if (subgroup !== "ALL" && subgroup !== "GROUP_1" && subgroup !== "GROUP_2") throw new Error("Недопустимая подгруппа.");
    await store.setUserSubgroup(command.userId, subgroup, userInput(ctx));
    await ctx.answerCallbackQuery("Подгруппа сохранена");
    await ctx.editMessageText(`Подгруппа: ${subgroupLabel(subgroup)}`);
  }));

  bot.on("message:text", async (ctx, next) => {
    const topic = getTopicFromMessage(ctx);
    if (!topic) return next();
    const userId = getUserId(ctx);
    const state = addStates.get(stateKey(topic, userId));
    if (!state || !state.type || !state.subject || !state.subgroup) return next();

    await runCommand(ctx, async () => {
      const type = state.type;
      const subject = state.subject;
      const subgroup = state.subgroup;
      if (!type || !subject || !subgroup) return;

      if (!state.deadline) {
        const deadline = parseDeadline(ctx.message.text.trim());
        if (!deadline) {
          await replyInTopic(ctx, "Неверный срок. Формат: ДД.ММ.ГГГГ ЧЧ:ММ", topic);
          return;
        }
        state.deadline = deadline;
        await replyInTopic(ctx, "Теперь отправьте текст задания.", topic);
        return;
      }

      const deadline = state.deadline;
      const description = ctx.message.text.trim();
      if (!description) {
        await replyInTopic(ctx, "Текст задания не может быть пустым.", topic);
        return;
      }

      await store.add(topic.chatId, topic.threadId, {
        type,
        subject,
        description,
        subgroup,
        deadline,
      }, userInput(ctx));
      addStates.delete(stateKey(topic, userId));
      await refreshPersistentMessages(ctx, store, topic);
    });
  });

  bot.command("edit", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const parsed = parseEditCommand(ctx.match);
    if (!parsed) {
      await replyInTopic(ctx, "Использование: /edit <номер> <новый текст>", command.topic);
      return;
    }
    if (!(await store.edit(command.topic.chatId, command.topic.threadId, parsed.id, parsed.text))) {
      await replyInTopic(ctx, "ДЗ с таким номером не найдено.", command.topic);
      return;
    }
    await refreshPersistentMessages(ctx, store, command.topic);
  }));

  bot.command("delete", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const id = parseId(ctx.match);
    if (id === null) {
      await replyInTopic(ctx, "Использование: /delete <номер>", command.topic);
      return;
    }
    const result = await store.remove(command.topic.chatId, command.topic.threadId, id);
    if (!result.removed) {
      await replyInTopic(ctx, "ДЗ с таким номером не найдено.", command.topic);
      return;
    }
    await refreshPersistentMessages(ctx, store, command.topic);
  }));

  bot.command("list", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    await refreshPersistentMessages(ctx, store, command.topic);
  }));

  bot.command("done", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const id = parseId(ctx.match);
    if (id === null) {
      await replyInTopic(ctx, "Использование: /done <номер>", command.topic);
      return;
    }
    const result = await store.markDone(command.topic.chatId, command.topic.threadId, id);
    if (!result) {
      await replyInTopic(ctx, "ДЗ с таким номером не найдено.", command.topic);
      return;
    }
    await refreshPersistentMessages(ctx, store, command.topic);
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
          const description = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
          if (description.includes("message is not modified")) return;
          if (!description.includes("message to edit not found") && !description.includes("message can't be edited")) throw error;
        }
      }

      const message = await ctx.api.sendMessage(topic.chatId, text, { message_thread_id: topic.threadId, parse_mode: "HTML" });
      await setMessageId(message.message_id);
      await ctx.api.pinChatMessage(topic.chatId, message.message_id, { disable_notification: true });
    });
  });
  refreshLocks.set(key, current);
  try { await current; } finally { if (refreshLocks.get(key) === current) refreshLocks.delete(key); }
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
  const message = ctx.callbackQuery?.message;
  if (!message || message.chat.type !== "supergroup" || !("message_thread_id" in message) || message.message_thread_id === undefined) {
    throw new Error("Выбор должен выполняться внутри Topic.");
  }
  return { topic: { chatId: message.chat.id, threadId: message.message_thread_id }, userId: getUserId(ctx) };
}

function getCallbackData(ctx: Context): string {
  const data = ctx.callbackQuery?.data;
  if (!data) throw new Error("Некорректный callback-запрос.");
  return data;
}

function getCommandContext(ctx: Context): CommandContext { return { topic: getTopic(ctx), userId: getUserId(ctx) }; }

function getTopic(ctx: Context): Topic {
  const topic = getTopicFromMessage(ctx);
  if (!topic) throw new Error("Команда должна быть отправлена внутри Telegram Topic.");
  return topic;
}

function getTopicFromMessage(ctx: Context): Topic | null {
  const message = ctx.msg;
  if (!message?.chat || message.chat.type !== "supergroup" || !message.is_topic_message || message.message_thread_id === undefined) return null;
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
  try {
    const topic = getTopicFromMessage(ctx);
    if (topic) await replyInTopic(ctx, message || "Не удалось выполнить команду.", topic);
    else if (ctx.callbackQuery?.message) await ctx.api.sendMessage(ctx.callbackQuery.message.chat.id, message || "Не удалось выполнить команду.");
  } catch (telegramError) { console.error("Failed to send command error to Telegram:", telegramError); }
}

async function replyInTopic(ctx: Context, text: string, topic?: Topic): Promise<void> {
  const target = topic ?? getTopic(ctx);
  await ctx.api.sendMessage(target.chatId, text, { message_thread_id: target.threadId });
}

export async function refreshMessage(api: Context["api"], store: HomeworkStore, topic: Topic): Promise<void> {
  const data = await store.getTopicMessages(topic.chatId, topic.threadId);
  const text = formatPersistentMessages(data);
  await refreshPersistentMessage({ api } as Context, store, topic, "ACTIVE", text.active, data.activeMessageId);
  await refreshPersistentMessage({ api } as Context, store, topic, "ARCHIVE", text.archive, data.archiveMessageId);
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
  return id && text ? { id, text } : null;
}

export function parseDeadline(value: string): Date | null {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, day, month, year, hours, minutes] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day) && date.getUTCHours() === Number(hours) && date.getUTCMinutes() === Number(minutes) ? date : null;
}
