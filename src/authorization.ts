import type { Context } from "grammy";
import { HomeworkStore } from "./store.js";

export async function authorizeBotUpdate(ctx: Context, store: HomeworkStore): Promise<boolean> {
  const chat = ctx.chat;
  const from = ctx.from;
  if (!chat || !from) return false;

  const command = getCommandName(ctx);
  if (command === "list") return true;

  const isCallback = Boolean(ctx.callbackQuery);
  const isCommand = command !== null;
  if (!isCommand && !isCallback) return true;

  if (chat.type !== "group" && chat.type !== "supergroup") {
    await deny(ctx, "Команды бота доступны только в группах.");
    return false;
  }

  let member;
  try {
    member = await ctx.api.getChatMember(chat.id, from.id);
  } catch (error) {
    console.warn("Could not verify Telegram group member:", error);
    await deny(ctx, "Не удалось проверить права пользователя. Убедитесь, что бот является администратором группы.");
    return false;
  }

  if (member.status === "creator") {
    await store.setGroupOwner(chat.id, from.id, "title" in chat ? chat.title : undefined);
    return true;
  }

  if (await store.isGroupAdmin(chat.id, from.id)) return true;

  await deny(ctx, "⛔ У вас нет прав для использования команд бота.\n\nОбратитесь к создателю группы, чтобы он назначил вам доступ.");
  return false;
}

export function getCommandName(ctx: Context): string | null {
  const text = ctx.msg?.text;
  if (!text) return null;
  const match = text.match(/^\/(\w+)(?:@\w+)?(?:\s|$)/);
  return match?.[1]?.toLowerCase() ?? null;
}

export async function deny(ctx: Context, text: string): Promise<void> {
  try {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text, show_alert: true });
      return;
    }
    if (ctx.chat) {
      const options = ctx.msg?.message_thread_id ? { message_thread_id: ctx.msg.message_thread_id } : undefined;
      await ctx.api.sendMessage(ctx.chat.id, text, options);
    }
  } catch (error) {
    console.warn("Could not send authorization error:", error);
  }
}
