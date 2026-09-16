import { Bot, InlineKeyboard, type Context } from "grammy";
import { HomeworkStore } from "./store.js";
import { formatPersistentMessages, IRNITU_SUBJECTS, MIPT_SUBJECTS, isValidSubject } from "./format.js";
import { parseAddCommand } from "./add-flow.js";
import type { HomeworkSubgroup, HomeworkType, PersistentMessageType } from "./types.js";

type Topic = { chatId: number; threadId: number };
type OutputDestination = Topic;
type CommandContext = { topic: Topic; userId: number };
type AddState = { topic: Topic; userId: number; type?: HomeworkType; subject?: string; subgroup?: HomeworkSubgroup; deadline?: Date };

const COMMAND_HELP = [
  "Команды:",
  "/add — добавить ДЗ через пошаговую форму",
  "/add <текст> [| ДД.ММ.ГГГГ ЧЧ:ММ] — быстрый вариант",
  "/edit <номер> <текст> — изменить ДЗ",
  "/delete <номер> — удалить ДЗ",
  "/list — обновить список ДЗ",
  "/done <номер> — отметить ДЗ выполненным",
  "/setactive <chat_id> <thread_id> | here — куда отправлять актуальные ДЗ",
  "/setarchive <chat_id> <thread_id> | here — куда отправлять архив ДЗ",
  "/settings — показать настройки вывода для текущего Topic",
].join("\n");

const refreshLocks = new Map<string, Promise<void>>();
const addStates = new Map<string, AddState>();

export function createBot(token: string, store: HomeworkStore): Bot {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => runCommand(ctx, async () => {
    const topic = getTopic(ctx);
    await refreshOutputMessages(ctx, store, topic);
    await replyInTopic(ctx, `Бот для домашних заданий готов.\n\n${COMMAND_HELP}`, topic);
  }));
  bot.command("help", async (ctx) => runCommand(ctx, async () => replyInTopic(ctx, COMMAND_HELP)));

  bot.command("add", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const input = ctx.match.trim();

    if (input) {
      const parsed = parseAddCommand(input);
      if (!parsed) throw new Error("Использование: /add <текст> | ДД.ММ.ГГГГ ЧЧ:ММ");
      await store.addHomework(command.topic, parsed.type, parsed.subject, parsed.description, parsed.subgroup, parsed.deadline, userInput(ctx));
      await refreshOutputMessages(ctx, store, command.topic);
      await replyInTopic(ctx, "✅ ДЗ добавлено.", command.topic);
      return;
    }

    addStates.set(stateKey(command.topic, command.userId), { topic: command.topic, userId: command.userId });
    await replyInTopic(ctx, "Выберите тип ДЗ:", command.topic, new InlineKeyboard().text("📚 ИРНИТУ", "add:type:IRNITU").text("📘 МФТИ", "add:type:MIPT"));
  }));

  bot.callbackQuery(/^add:type:(IRNITU|MIPT)$/, async (ctx) => runCommand(ctx, async () => {
    const state = getAddState(ctx);
    const selectedType = getCallbackData(ctx).split(":")[2];
    if (selectedType !== "IRNITU" && selectedType !== "MIPT") throw new Error("Недопустимый тип ДЗ.");
    state.type = selectedType;
    const subjects = state.type === "IRNITU" ? IRNITU_SUBJECTS : MIPT_SUBJECTS;
    const keyboard = new InlineKeyboard();
    for (let index = 0; index < subjects.length; index += 1) keyboard.text(subjects[index], `add:subject:${index}`).row();
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Выберите предмет:", { reply_markup: keyboard });
  }));

  bot.callbackQuery(/^add:subject:(\d+)$/, async (ctx) => runCommand(ctx, async () => {
    const state = getAddState(ctx);
    if (!state.type) throw new Error("Сначала выберите тип ДЗ.");
    const index = Number(getCallbackData(ctx).slice("add:subject:".length));
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
    const subgroup = getCallbackData(ctx).split(":")[2];
    if (subgroup !== "ALL" && subgroup !== "GROUP_1" && subgroup !== "GROUP_2") throw new Error("Недопустимая подгруппа.");
    state.subgroup = subgroup;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Введите срок: ДД.ММ.ГГГГ ЧЧ:ММ\nИли напишите: без срока");
  }));

  bot.command("setactive", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const destination = parseOutputDestination(ctx.match, command.topic);
    await configureOutputDestination(ctx, store, command.topic, "ACTIVE", destination);
    await refreshOutputMessage(ctx, store, command.topic, "ACTIVE");
    await replyInTopic(ctx, `Актуальные ДЗ теперь находятся в ${formatDestination(destination)}.`, command.topic);
  }));

  bot.command("setarchive", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const destination = parseOutputDestination(ctx.match, command.topic);
    await configureOutputDestination(ctx, store, command.topic, "ARCHIVE", destination);
    await refreshOutputMessage(ctx, store, command.topic, "ARCHIVE");
    await replyInTopic(ctx, `Архив ДЗ теперь находится в ${formatDestination(destination)}.`, command.topic);
  }));

  bot.command("settings", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const [active, archive] = await Promise.all([
      store.getPersistentMessageInfo(command.topic.chatId, command.topic.threadId, "ACTIVE"),
      store.getPersistentMessageInfo(command.topic.chatId, command.topic.threadId, "ARCHIVE"),
    ]);
    const formatSetting = (value: { destinationChatId: number | null; destinationThreadId: number | null } | null) => {
      if (!value || value.destinationChatId === null) return "не настроено";
      return formatDestination({ chatId: value.destinationChatId, threadId: value.destinationThreadId ?? 0 });
    };
    await replyInTopic(ctx, `Настройки вывода текущего Topic:\n\nАктуальные ДЗ: ${formatSetting(active)}\nАрхив ДЗ: ${formatSetting(archive)}\n\nИзменить:\n/setactive <chat_id> <thread_id>\n/setactive here\n/setarchive <chat_id> <thread_id>\n/setarchive here`, command.topic);
  }));

  bot.on("message:text", async (ctx, next) => {
    const topic = getTopicFromMessage(ctx);
    if (!topic) return next();
    const userId = getUserId(ctx);
    const state = findAddState(topic, userId);
    if (!state || !state.type || !state.subject || !state.subgroup) return next();

    await runCommand(ctx, async () => {
      const type = state.type;
      const subject = state.subject;
      const subgroup = state.subgroup;
      if (!type || !subject || !subgroup) return;

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
      await store.addHomework(topic, type, subject, description, subgroup, deadline, userInput(ctx));
      deleteAddState(state);
      await refreshOutputMessages(ctx, store, topic);
      await replyInTopic(ctx, "✅ ДЗ добавлено.", topic);
    });
  });

  bot.command("edit", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const parsed = parseEditCommand(ctx.match);
    if (!parsed) throw new Error("Использование: /edit <номер> <новый текст>");
    await store.editHomework(command.topic, parsed.id, parsed.text, command.userId, userInput(ctx));
    await refreshOutputMessages(ctx, store, command.topic);
    await replyInTopic(ctx, "✅ ДЗ изменено.", command.topic);
  }));

  bot.command("delete", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const id = parseId(ctx.match);
    if (id === null) throw new Error("Использование: /delete <номер>");
    await store.deleteHomework(command.topic, id, command.userId, userInput(ctx));
    await refreshOutputMessages(ctx, store, command.topic);
    await replyInTopic(ctx, "🗑 ДЗ удалено.", command.topic);
  }));

  bot.command("done", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    const id = parseId(ctx.match);
    if (id === null) throw new Error("Использование: /done <номер>");
    await store.completeHomework(command.topic, id, command.userId, userInput(ctx));
    await refreshOutputMessages(ctx, store, command.topic);
    await replyInTopic(ctx, "✅ ДЗ отмечено выполненным.", command.topic);
  }));

  bot.command("list", async (ctx) => runCommand(ctx, async () => {
    const command = getCommandContext(ctx);
    await refreshOutputMessages(ctx, store, command.topic);
    await replyInTopic(ctx, "🔄 Списки ДЗ обновлены.", command.topic);
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
  const candidates = [...addStates.values()].filter((state) => state.topic.chatId === topic.chatId && state.userId === userId);
  if (candidates.length !== 1) return undefined;
  return candidates[0];
}

function deleteAddState(state: AddState): void {
  addStates.delete(stateKey(state.topic, state.userId));
}

function stateKey(topic: Topic, userId: number): string {
  return `${topic.chatId}:${topic.threadId}:${userId}`;
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
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, day, month, year, hours, minutes] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day) && date.getUTCHours() === Number(hours) && date.getUTCMinutes() === Number(minutes) ? date : null;
}

async function runCommand(ctx: Context, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error("Bot command error:", error);
    const text = error instanceof Error ? error.message : "Произошла ошибка.";
    try { await replyInTopic(ctx, `❌ ${text}`); } catch { await ctx.reply(`❌ ${text}`); }
  }
}

async function replyInTopic(ctx: Context, text: string, topic?: Topic, reply_markup?: InlineKeyboard): Promise<void> {
  const target = topic ?? getTopic(ctx);
  const options: { message_thread_id?: number; reply_markup?: InlineKeyboard } = {};
  if (target.threadId > 0) options.message_thread_id = target.threadId;
  if (reply_markup) options.reply_markup = reply_markup;
  await ctx.api.sendMessage(target.chatId, text, options);
}

function getCallbackData(ctx: Context): string {
  return ctx.callbackQuery?.data ?? "";
}

function subgroupKeyboard(prefix: string): InlineKeyboard {
  return new InlineKeyboard().text("Все", `${prefix}ALL`).row().text("1 подгруппа", `${prefix}GROUP_1`).row().text("2 подгруппа", `${prefix}GROUP_2`);
}

export function parseOutputDestination(value: string, currentTopic: Topic): OutputDestination {
  const normalized = value.trim();
  if (!normalized || normalized === "here") return currentTopic;

  const compact = normalized.replace(/^here\s*[:/]\s*/, "here:");
  if (compact.startsWith("here:")) {
    const threadId = parseThreadId(compact.slice("here:".length));
    return { chatId: currentTopic.chatId, threadId };
  }

  const colon = normalized.match(/^(-?\d+):(\d+)$/);
  if (colon) return { chatId: parseChatId(colon[1]), threadId: parseThreadId(colon[2]) };

  const parts = normalized.split(/\s+/);
  if (parts.length !== 2) throw new Error("Использование: /setactive <chat_id> <thread_id> или /setactive here");
  return { chatId: parseChatId(parts[0]), threadId: parseThreadId(parts[1]) };
}

function parseChatId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id === 0) throw new Error("Некорректный chat_id.");
  return id;
}

function parseThreadId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 0) throw new Error("Некорректный threadId.");
  return id;
}

async function configureOutputDestination(ctx: Context, store: HomeworkStore, topic: Topic, messageType: PersistentMessageType, destination: OutputDestination): Promise<void> {
  const previous = await store.getPersistentMessageInfo(topic.chatId, topic.threadId, messageType);
  if (previous?.messageId && previous.destinationChatId !== null) {
    try { await ctx.api.deleteMessage(previous.destinationChatId, previous.messageId); } catch { /* message may already be deleted */ }
  }
  await store.setPersistentMessageDestination(topic.chatId, topic.threadId, messageType, destination.chatId, destination.threadId);
}

async function refreshOutputMessages(ctx: Context, store: HomeworkStore, topic: Topic): Promise<void> {
  await refreshOutputMessage(ctx, store, topic, "ACTIVE");
  await refreshOutputMessage(ctx, store, topic, "ARCHIVE");
}

async function refreshOutputMessage(ctx: Context, store: HomeworkStore, topic: Topic, messageType: PersistentMessageType): Promise<void> {
  const lockKey = `${topic.chatId}:${topic.threadId}:${messageType}`;
  const previous = refreshLocks.get(lockKey) ?? Promise.resolve();
  const next = previous.then(async () => {
    const data = await store.getTopicMessages(topic.chatId, topic.threadId);
    const text = formatPersistentMessages(data)[messageType === "ACTIVE" ? "active" : "archive"];
    const saved = await store.getPersistentMessageInfo(topic.chatId, topic.threadId, messageType);
    if (!saved || saved.destinationChatId === null) return;
    const destinationChatId = saved.destinationChatId;

    await store.withPersistentMessageLock(topic.chatId, topic.threadId, messageType, async (messageId, setMessageId) => {
      if (messageId) {
        try {
          await ctx.api.editMessageText(destinationChatId, messageId, text, { parse_mode: "HTML" });
          return;
        } catch (error) {
          console.warn(`Could not edit ${messageType} output message:`, error);
        }
      }
      const options: { parse_mode: "HTML"; message_thread_id?: number } = { parse_mode: "HTML" };
      if (saved.destinationThreadId !== null && saved.destinationThreadId > 0) options.message_thread_id = saved.destinationThreadId;
      const message = await ctx.api.sendMessage(destinationChatId, text, options);
      await setMessageId(message.message_id);
      try { await ctx.api.pinChatMessage(destinationChatId, message.message_id, { disable_notification: true }); } catch (error) { console.warn(`Could not pin ${messageType} output message:`, error); }
    });
  });
  refreshLocks.set(lockKey, next);
  try { await next; } finally { if (refreshLocks.get(lockKey) === next) refreshLocks.delete(lockKey); }
}

function formatDestination(destination: OutputDestination): string {
  if (destination.threadId > 0) return `чате ${destination.chatId}, Topic ${destination.threadId}`;
  return `чате ${destination.chatId}`;
}
