import type { HomeworkItem, HomeworkSubgroup, HomeworkType, TopicHomework } from "./types.js";

export const TELEGRAM_MESSAGE_LIMIT = 4096;

export const IRNITU_SUBJECTS = [
  "Вычислительная математика",
  "Иностранный язык",
  "Исследование операций",
  "Критическое и системное мышление",
  "Организация ЭВМ и периферийные устройства",
] as const;

export const MIPT_SUBJECTS = [
  "Основы IT-технологий(АКОС)",
  "Программирование на языке Python",
  "Теория вероятностей",
] as const;

export function subjectsForType(type: HomeworkType): readonly string[] {
  return type === "IRNITU" ? IRNITU_SUBJECTS : MIPT_SUBJECTS;
}

export function isValidSubject(type: HomeworkType, subject: string): boolean {
  return subjectsForType(type).includes(subject);
}

export function formatHomework(topic: TopicHomework): string {
  const title = topic.type === "IRNITU" ? "📚 <b>ДЗ ИРНИТУ</b>" : "📘 <b>ДЗ МФТИ</b>";
  const lines = [title, ""];

  if (topic.items.length === 0) return lines.concat("Пока домашних заданий нет.").join("\n");

  let hiddenItems = 0;
  for (let index = 0; index < topic.items.length; index += 1) {
    const item = topic.items[index];
    const block = formatItem(item, index + 1);
    const separator = lines.length > 2 ? "\n" : "";
    if (fits(lines, `${separator}${block}`)) {
      if (separator) lines.push("");
      lines.push(block);
      continue;
    }

    const remaining = topic.items.length - index;
    const warning = `⚠️ Ещё ${remaining} ${pluralizeItems(remaining)} скрыто из-за ограничения Telegram на длину сообщения.`;
    if (fits(lines, warning)) lines.push(warning);
    hiddenItems = remaining;
    break;
  }

  if (hiddenItems > 0 && lines.length === 2) lines.push(`⚠️ Список слишком большой: ${hiddenItems} ${pluralizeItems(hiddenItems)} скрыто.`);
  return lines.join("\n");
}

function formatItem(item: HomeworkItem, number: number): string {
  const mark = item.completed ? "✅" : "⬜";
  const subgroup = subgroupLabel(item.subgroup);
  const deadline = item.deadline ? `\n⏰ до ${formatDeadline(item.deadline)}` : "";
  return `${number}. ${mark} <b>${escapeHtml(item.subject)}</b>\n${escapeHtml(item.description)}\n👥 ${subgroup}${deadline}`;
}

export function subgroupLabel(subgroup: HomeworkSubgroup): string {
  if (subgroup === "GROUP_1") return "1 подгруппа";
  if (subgroup === "GROUP_2") return "2 подгруппа";
  return "Все";
}

export function formatDeadline(deadline: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(deadline.getDate())}.${pad(deadline.getMonth() + 1)}.${deadline.getFullYear()} ${pad(deadline.getHours())}:${pad(deadline.getMinutes())}`;
}

function fits(lines: string[], next: string): boolean {
  return [...lines, next].join("\n").length <= TELEGRAM_MESSAGE_LIMIT;
}

function pluralizeItems(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "задание";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "задания";
  return "заданий";
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
