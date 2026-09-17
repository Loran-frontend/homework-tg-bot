import type { Bot, Context } from "grammy";
import { HomeworkStore } from "./store.js";
import { authorizeBotUpdate, deny, getCommandName } from "./authorization.js";

export function installGroupRoleManagement(bot: Bot, store: HomeworkStore): void {
  bot.use(async (ctx, next) => {
    if (!(await authorizeBotUpdate(ctx, store))) return;
    await next();
  });

  bot.command("role", async (ctx) => {
    if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") || !ctx.from) return;
    if (!(await store.isGroupOwner(ctx.chat.id, ctx.from.id))) {
      await deny(ctx, "⛔ Управлять ролями может только создатель группы.");
      return;
    }

    const input = ctx.match.trim().toLowerCase();
    const action = input.split(/\s+/)[0] ?? "";

    if (action === "list") {
      const admins = await store.listGroupAdmins(ctx.chat.id);
      if (admins.length === 0) {
        await ctx.reply("Назначенных пользователей пока нет.");
        return;
      }
      const lines: string[] = ["👥 Пользователи с доступом:"];
      for (const admin of admins) {
        try {
          const member = await ctx.api.getChatMember(ctx.chat.id, admin.telegramId);
          lines.push(`• ${formatUser(member.user)} — ${admin.telegramId}`);
        } catch {
          lines.push(`• ${admin.telegramId}`);
        }
      }
      await ctx.reply(lines.join("\n"));
      return;
    }

    if (action !== "add" && action !== "remove") {
      await ctx.reply("Использование:\n/role add — ответом на сообщение пользователя\n/role remove — ответом на сообщение пользователя\n/role list");
      return;
    }

    const target = ctx.msg?.reply_to_message?.from;
    if (!target) {
      await ctx.reply(`Чтобы ${action === "add" ? "назначить" : "снять доступ с"} пользователя, используй команду ответом на его сообщение.`);
      return;
    }
    if (target.id === ctx.from.id) {
      await ctx.reply("Создателю группы не нужно назначать доступ самому себе.");
      return;
    }
    if (target.is_bot) {
      await ctx.reply("Нельзя назначить роль боту.");
      return;
    }

    try {
      const targetMember = await ctx.api.getChatMember(ctx.chat.id, target.id);
      if (["left", "kicked"].includes(targetMember.status)) {
        await ctx.reply("Пользователь больше не состоит в группе.");
        return;
      }
    } catch {
      await ctx.reply("Не удалось проверить пользователя в группе.");
      return;
    }

    if (action === "add") {
      await store.addGroupAdmin(ctx.chat.id, target.id, ctx.chat.title);
      await ctx.reply(`✅ ${formatUser(target)} получил доступ к командам бота.`);
    } else {
      await store.removeGroupAdmin(ctx.chat.id, target.id);
      await ctx.reply(`✅ Доступ для ${formatUser(target)} удалён.`);
    }
  });
}

function formatUser(user: { first_name: string; last_name?: string; username?: string }): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return user.username ? `${name} (@${user.username})` : name;
}
