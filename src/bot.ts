import { randomUUID } from "node:crypto";
import { Bot, InlineKeyboard, type Context } from "grammy";
import { HomeworkStore } from "./store.js";
import { IRNITU_SUBJECTS, MIPT_SUBJECTS, isValidSubject } from "./format.js";
import { parseAddCommand } from "./add-flow.js";
import { refreshMessage } from "./refresh-compat.js";
import type { HomeworkSubgroup, HomeworkType, PersistentMessageType } from "./types.js";

type Topic = { chatId: number; threadId: number };
type CommandContext = { topic: Topic; userId: number };
type AddState = { id: string; origin: Topic; userId: number; type?: HomeworkType; subject?: string; subgroup?: HomeworkSubgroup; deadline?: Date };

const COMMAND_HELP = [
  "Команды:",
  "/add — добавить ДЗ через пошаговую форму",
  "/add <текст> [| ДД.ММ.ГГГГ ЧЧ:ММ] — быстрый вариант",
  "/edit <номер> <текст> — изменить ДЗ",
  "/delete <номер> — удалить ДЗ",
  "/list — обновить списки ДЗ",
  "/setactive <chat_id> <thread_id> | here — настроить актуальные ДЗ",
  "/setarchive <chat_id> <thread_id> | here — настроить архив ДЗ",
  "/settings — показать настройки вывода",
].join("\n");

const addStates = new Map<string, AddState>();

export function createBot(token: string, store: HomeworkStore): Bot {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => runCommand(ctx, async () => {
    const topic = getTopic(ctx);
    await refreshMessage(bot, store, topic);
    await replyInTopic(ctx, `Бот для домашних заданий готов.\n\n${COMMAND_HELP}`, topic);
  }));

  bot.command("help", async (ctx) => runCommand(ctx, async () => {
    await replyInTopic(ctx, COMMAND_HELP, getTopic(ctx));
  }));

  bot.command("add", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const input = ctx.match.trim();

    if (input) {
      const parsed = parseAddCommand(input);
      if (!parsed) throw new Error("Использование: /add <текст> | ДД.ММ.ГГГГ ЧЧ:ММ");
      await store.addHomework(command.topic, parsed.type, parsed.subject, parsed.description, parsed.subgroup, parsed.deadline, userInput(ctx));
      await refreshMessage(bot, store, command.topic);
      await replyInTopic(ctx, "✅ ДЗ добавлено.", command.topic);
      return;
    }

    const state: AddState = { id: randomUUID(), origin: command.topic, userId: command.userId };
    addStates.set(stateKey(command.topic, command.userId), state);
    const keyboard = new InlineKeyboard()
      .text("📚 ИРНИТУ", `add:type:IRNITU:${state.id}`)
      .text("📘 МФТИ", `add:type:MIPT:${state.id}`);
    await replyInTopic(ctx, "Выберите тип ДЗ:", command.topic, keyboard);
  }));

  bot.callbackQuery(/^add:type:(IRNITU|MIPT):([0-9a-f-]+)$/, async (ctx) => runCommand(ctx, async () => {
    const state = getAddState(ctx);
    const data = getCallbackData(ctx).split(":");
    const selectedType = data[2];
    if (selectedType !== "IRNITU" && selectedType !== "MIPT") throw new Error("Недопустимый тип ДЗ.");
    if (data[3] !== state.id) throw new Error("Сессия добавления ДЗ устарела.");

    state.type = selectedType;
    const subjects = selectedType === "IRNITU" ? IRNITU_SUBJECTS : MIPT_SUBJECTS;
    const keyboard = new InlineKeyboard();
    for (let index = 0; index < subjects.length; index += 1) keyboard.text(subjects[index], `add:subject:${index}:${state.id}`).row();
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Выберите предмет:", { reply_markup: keyboard });
  }));

  bot.callbackQuery(/^add:subject:(\d+):([0-9a-f-]+)$/, async (ctx) => runCommand(ctx, async () => {
    const state = getAddState(ctx);
    if (!state.type) throw new Error("Сначала выберите тип ДЗ.");
    const data = getCallbackData(ctx).split(":");
    if (data[3] !== state.id) throw new Error("Сессия добавления ДЗ устарела.");

    const subjects = state.type === "IRNITU" ? IRNITU_SUBJECTS : MIPT_SUBJECTS;
    const subject = subjects[Number(data[2])];
    if (!subject || !isValidSubject(state.type, subject)) throw new Error("Недопустимый предмет.");
    state.subject = subject;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Для кого это ДЗ?", { reply_markup: subgroupKeyboard(state.id) });
  }));

  bot.callbackQuery(/^add:subgroup:(ALL|GROUP_1|GROUP_2):([0-9a-f-]+)$/, async (ctx) => runCommand(ctx, async () => {
    const state = getAddState(ctx);
    if (!state.type || !state.subject) throw new Error("Сначала выберите тип и предмет.");
    const data = getCallbackData(ctx).split(":");
    if (data[3] !== state.id) throw new Error("Сессия добавления ДЗ устарела.");

    const subgroup = data[2];
    if (subgroup !== "ALL" && subgroup !== "GROUP_1" && subgroup !== "GROUP_2") throw new Error("Недопустимая подгруппа.");
    state.subgroup = subgroup;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Введите срок: ДД.ММ.ГГГГ ЧЧ:ММ\nИли напишите: без срока");
  }));

  bot.command("setactive", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const destination = parseOutputDestination(ctx.match, command.topic);
    await configureOutputDestination(ctx, store, command.topic, "ACTIVE", destination);
    await refreshMessage(bot, store, command.topic);
    await replyInTopic(ctx, `Актуальные ДЗ теперь находятся в ${formatDestination(destination)}.`, command.topic);
  }));

  bot.command("setarchive", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const destination = parseOutputDestination(ctx.match, command.topic);
    await configureOutputDestination(ctx, store, command.topic, "ARCHIVE", destination);
    await refreshMessage(bot, store, command.topic);
    await replyInTopic(ctx, `Архив ДЗ теперь находится в ${formatDestination(destination)}.`, command.topic);
  }));

  bot.command("settings", async (ctx) => runCommand(ctx, async () => {
    const topic = getTopic(ctx);
    const [active, archive] = await Promise.all([
      store.getPersistentMessageInfo(topic.chatId, topic.threadId, "ACTIVE"),
      store.getPersistentMessageInfo(topic.chatId, topic.threadId, "ARCHIVE"),
    ]);
    const formatSetting = (value: { destinationChatId: number | null; destinationThreadId: number | null } | null): string => {
      if (!value || value.destinationChatId === null) return "не настроено";
      return formatDestination({ chatId: value.destinationChatId, threadId: value.destinationThreadId ?? 0 });
    };
    await replyInTopic(ctx, `Глобальные настройки вывода:\n\nАктуальные ДЗ: ${formatSetting(active)}\nАрхив ДЗ: ${formatSetting(archive)}`, topic);
  }));

  bot.on("message:text", async (ctx, next) => {
    const topic = getTopicFromMessage(ctx);
    if (!topic) return next();
    const state = findAddState(topic, getUserId(ctx));
    if (!state || !state.type || !state.subject || !state.subgroup) return next();

    await runCommand(ctx, async () => {
      if (!state.type || !state.subject || !state.subgroup) return;
      if (!state.deadline) {
        const input = ctx.message.text.trim();
        if (input.toLowerCase() === "без срока") {
          state.deadline = new Date(0);
        } else {
          const deadline = parseDeadline(input);
          if (!deadline) {
            await replyInTopic(ctx, "Неверный срок. Формат: ДД.ММ.ГГГГ ЧЧ:ММ\nИли напишите: без срока", topic);
            return;
          }
          state.deadline = deadline;
        }
        await replyInTopic(ctx, "Теперь отправьте текст задания.", topic);
        return;
      }

      const description = ctx.message.text.trim();
      if (!description) {
        await replyInTopic(ctx, "Текст задания не может быть пустым.", topic);
        return;
      }

      const deadline = state.deadline.getTime() === 0 ? null : state.deadline;
      await store.addHomework(topic, state.type, state.subject, description, state.subgroup, deadline, userInput(ctx));
      deleteAddState(state);
      await refreshMessage(bot, store, topic);
      await replyInTopic(ctx, "✅ ДЗ добавлено.", topic);
    });
  });

  bot.command("edit", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const parsed = parseEditCommand(ctx.match);
    if (!parsed) throw new Error("Использование: /edit <номер> <новый текст>");
    const updated = await store.editHomework(command.topic, parsed.id, parsed.text, command.userId, userInput(ctx));
    if (!updated) throw new Error(`ДЗ #${parsed.id} не найдено.`);
    await refreshMessage(bot, store, command.topic);
    await replyInTopic(ctx, "✅ ДЗ изменено.", command.topic);
  }));

  bot.command("delete", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const id = parseId(ctx.match);
    if (id === null) throw new Error("Использование: /delete <номер>");
    const result = await store.deleteHomework(command.topic, id, command.userId, userInput(ctx));
    if (!result.removed) throw new Error(`ДЗ #${id} не найдено.`);
    await refreshMessage(bot, store, command.topic);
    await replyInTopic(ctx, "🗑 ДЗ удалено.", command.topic);
  }));

  bot.command("list", async (ctx) => runCommand(ctx, async () => {
    const topic = getTopic(ctx);
    await refreshMessage(bot, store, topic);
    await replyInTopic(ctx, "🔄 Списки ДЗ обновлены.", topic);
  }));

  return bot;
}

function getTopic(ctx: Context): Topic {
  return { chatId: Number(ctx.chat?.id ?? 0), threadId: Number(ctx.msg?.message_thread_id ?? 0) };
}

function getTopicFromMessage(ctx: Context): Topic | null {
  if (!ctx.chat) return null;
  return { chatId: Number(ctx.chat.id), threadId: Number(ctx.message?.message_thread_id ?? 0) };
}

function getCommandContext(ctx: Context): CommandContext {
  return { topic: getTopic(ctx), userId: getUserId(ctx) };
}

function getCallbackContext(ctx: Context): CommandContext {
  const message = ctx.callbackQuery?.message;
  if (!message) throw new Error("Команда доступна только в сообщении.");
  return { topic: { chatId: Number(message.chat.id), threadId: Number(message.message_thread_id ?? 0) }, userId: getUserId(ctx) };
}

function getAddState(ctx: Context): AddState {
  const command = getCallbackContext(ctx);
  const state = findAddState(command.topic, command.userId);
  if (!state) throw new Error("Сессия добавления ДЗ не найдена. Повторите /add.");
  return state;
}

function findAddState(topic: Topic, userId: number): AddState | undefined {
  const exact = addStates.get(stateKey(topic, userId));
  if (exact) return exact;
  const candidates = [...addStates.values()].filter((state) => state.origin.chatId === topic.chatId && state.userId === userId);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function deleteAddState(state: AddState): void {
  addStates.delete(stateKey(state.origin, state.userId));
}

function stateKey(topic: Topic, userId: number): string {
  return `${topic.chatId}:${topic.threadId}:${userId}`;
}

function subgroupKeyboard(id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Все", `add:subgroup:ALL:${id}`).row()
    .text("1 подгруппа", `add:subgroup:GROUP_1:${id}`).row()
    .text("2 подгруппа", `add:subgroup:GROUP_2:${id}`);
}

function getUserId(ctx: Context): number {
  const id = ctx.from?.id;
  if (!id) throw new Error("Не удалось определить пользователя.");
  return Number(id);
}

function userInput(ctx: Context): { telegramId: number; username?: string; firstName?: string; lastName?: string } {
  const user = ctx.from;
  if (!user) throw new Error("Не удалось определить пользователя.");
  return { telegramId: user.id, username: user.username, firstName: user.first_name, lastName: user.last_name };
}

export function parseId(value: string): number | null {
  const id = Number(value.trim());
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function parseEditCommand(value: string): { id: number; text: string } | null {
  const match = value.trim().match(/^(\d+)\s+(.+)$/s);
  if (!match) return null;
  return { id: Number(match[1]), text: match[2].trim() };
}

export function parseDeadline(value: string): Date | null {
  const match = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, day, month, year, hours, minutes] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes)));
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day)
    && date.getUTCHours() === Number(hours)
    && date.getUTCMinutes() === Number(minutes)
    ? date
    : null;
}

export function parseOutputDestination(value: string, current: Topic): Topic {
  const input = value.trim();
  if (!input || input.toLowerCase() === "here") return current;
  const parts = input.split(/\s+/);
  if (parts.length !== 2) throw new Error("Использование: <chat_id> <thread_id> или here");
  const chatId = Number(parts[0]);
  const threadId = Number(parts[1]);
  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(threadId) || threadId < 0) throw new Error("Некорректные chat_id или thread_id.");
  return { chatId, threadId };
}

async function configureOutputDestination(ctx: Context, store: HomeworkStore, currentTopic: Topic, messageType: PersistentMessageType, destination: Topic): Promise<void> {
  const current = await store.getPersistentMessageInfo(currentTopic.chatId, currentTopic.threadId, messageType);
  const sameDestination = current?.destinationChatId === destination.chatId && (current.destinationThreadId ?? 0) === destination.threadId;
  if (sameDestination) return;

  if (current?.messageId && current.messageId > 0 && current.destinationChatId !== null) {
    try {
      await ctx.api.deleteMessage(current.destinationChatId, current.messageId);
    } catch (error) {
      console.warn(`Could not delete old ${messageType} output message:`, error);
    }
  }

  await store.setPersistentMessageDestination(currentTopic.chatId, currentTopic.threadId, messageType, destination.chatId, destination.threadId);
}

function formatDestination(destination: Topic): string {
  return `${destination.chatId}:${destination.threadId}`;
}

function getCallbackData(ctx: Context): string {
  const data = ctx.callbackQuery?.data;
  if (!data) throw new Error("Данные кнопки не найдены.");
  return data;
}

async function runCommand(ctx: Context, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error("Bot command error:", error);
    const text = error instanceof Error ? error.message : "Произошла ошибка.";
    try {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text, show_alert: true });
      else await replyInTopic(ctx, `❌ ${text}`, getTopic(ctx));
    } catch (replyError) {
      console.error("Could not send bot error message:", replyError);
    }
  }
}

async function replyInTopic(ctx: Context, text: string, topic: Topic = getTopic(ctx), replyMarkup?: InlineKeyboard): Promise<void> {
  const options: { message_thread_id?: number; reply_markup?: InlineKeyboard } = {};
  if (topic.threadId > 0) options.message_thread_id = topic.threadId;
  if (replyMarkup) options.reply_markup = replyMarkup;
  await ctx.api.sendMessage(topic.chatId, text, options);
}
