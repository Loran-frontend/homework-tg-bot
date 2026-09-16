import type { TopicHomework } from "./types.js";

export const TELEGRAM_MESSAGE_LIMIT = 4096;

export function formatHomework(topic: TopicHomework): string {
  const lines = ["📚 <b>Домашние задания</b>", ""];

  if (topic.items.length === 0) {
    return lines.concat("Пока домашних заданий нет.").join("\n");
  }

  let hiddenItems = 0;

  for (let index = 0; index < topic.items.length; index += 1) {
    const item = topic.items[index];
    const mark = item.completed ? "✅" : "⬜";
    const fullLine = `${item.id}. ${mark} ${escapeHtml(item.text)}`;

    if (fits(lines, fullLine)) {
      lines.push(fullLine);
      continue;
    }

    const remaining = topic.items.length - index;
    const warning = `⚠️ Ещё ${remaining} ${pluralizeItems(remaining)} скрыто из-за ограничения Telegram на длину сообщения.`;
    if (fits(lines, warning)) lines.push(warning);
    hiddenItems = remaining;
    break;
  }

  if (hiddenItems > 0 && lines.length === 2) {
    lines.push(`⚠️ Список слишком большой: ${hiddenItems} ${pluralizeItems(hiddenItems)} скрыто.`);
  }

  return lines.join("\n");
}

function fits(lines: string[], nextLine: string): boolean {
  return [...lines, nextLine].join("\n").length <= TELEGRAM_MESSAGE_LIMIT;
}

function pluralizeItems(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "задание";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "задания";
  return "заданий";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
