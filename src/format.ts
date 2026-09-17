import type { HomeworkItem, HomeworkSubgroup, HomeworkType, TopicHomework, TopicMessages } from "./types.js";

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
  return formatSection(topic.type === "IRNITU" ? "📚 <b>ДЗ ИРНИТУ</b>" : "📘 <b>ДЗ МФТИ</b>", topic.items, false);
}

export function formatPersistentMessages(data: TopicMessages): { active: string; archive: string } {
  return {
    active: formatCombined("📚 <b>Актуальные ДЗ</b>", data.active, false),
    archive: formatCombined("🗄 <b>Архив ДЗ</b>", data.archive, true),
  };
}

function formatCombined(title: string, lists: TopicHomework[], archive: boolean): string {
  const grouped: Record<HomeworkType, HomeworkItem[]> = {
    IRNITU: [],
    MIPT: [],
  };

  for (const list of lists) {
    grouped[list.type].push(...list.items);
  }

  const sections: string[] = [];
  if (grouped.IRNITU.length > 0) {
    sections.push(formatSection("📚 <b>ДЗ ИРНИТУ</b>", grouped.IRNITU, archive));
  }
  if (grouped.MIPT.length > 0) {
    sections.push(formatSection("📘 <b>ДЗ МФТИ</b>", grouped.MIPT, archive));
  }
  if (sections.length === 0) {
    sections.push("Нет заданий.");
  }

  return capMessage([title, "", sections.join("\n\n────────────────\n\n")].join("\n"));
}

function formatSection(title: string, items: HomeworkItem[], archive: boolean): string {
  const lines = [title, ""];
  if (items.length === 0) {
    lines.push("Нет заданий.");
    return lines.join("\n");
  }

  for (let index = 0; index < items.length; index += 1) {
    const block = formatItem(items[index], archive);
    const candidate = [...lines, ...(lines.length > 2 ? ["", block] : [block])].join("\n");
    if (candidate.length <= TELEGRAM_MESSAGE_LIMIT) {
      if (lines.length > 2) lines.push("");
      lines.push(block);
      continue;
    }
    lines.push(`⚠️ Ещё ${items.length - index} ${pluralizeItems(items.length - index)} скрыто из-за ограничения Telegram.`);
    break;
  }

  return lines.join("\n");
}

function formatItem(item: HomeworkItem, archive: boolean): string {
  const mark = item.completed ? "✅" : "⬜";
  const deadline = item.deadline ? `\n⏰ до ${formatDeadline(item.deadline)}` : "";
  const archived = archive ? "\n🗄 В архиве" : "";
  return `${item.id}. ${mark} <b>${escapeHtml(item.subject)}</b>\n${formatStoredDescription(item.description)}\n👥 ${subgroupLabel(item.subgroup)}${deadline}${archived}`;
}

/**
 * Converts Telegram message entities to safe Telegram HTML while preserving
 * links such as [текст](https://example.com). JavaScript string indexes and
 * Telegram entity offsets both use UTF-16 code units, so slice() is suitable.
 */
export function telegramTextToHtml(
  text: string,
  entities: readonly TelegramTextEntity[] | undefined,
): string {
  if (!entities || entities.length === 0) return escapeHtml(text);

  const supported = entities
    .filter((entity) => entity.length > 0 && entity.offset >= 0 && entity.offset + entity.length <= text.length)
    .sort((a, b) => a.offset - b.offset || b.length - a.length);

  if (supported.length === 0) return escapeHtml(text);

  const boundaries = new Set<number>([0, text.length]);
  for (const entity of supported) {
    boundaries.add(entity.offset);
    boundaries.add(entity.offset + entity.length);
  }

  const points = [...boundaries].sort((a, b) => a - b);
  const result: string[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const segment = text.slice(start, end);
    const active = supported.filter((entity) => entity.offset <= start && entity.offset + entity.length >= end);

    let value = escapeHtml(segment);
    for (let entityIndex = active.length - 1; entityIndex >= 0; entityIndex -= 1) {
      value = wrapTelegramEntity(value, active[entityIndex]);
    }
    result.push(value);
  }

  return result.join("");
}

export interface TelegramTextEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
}

function wrapTelegramEntity(value: string, entity: TelegramTextEntity): string {
  switch (entity.type) {
    case "text_link":
      return `<a href="${escapeHtmlAttribute(entity.url ?? "")}">${value}</a>`;
    case "url": {
      const url = unescapeHtml(value);
      return `<a href="${escapeHtmlAttribute(url)}">${value}</a>`;
    }
    case "bold": return `<b>${value}</b>`;
    case "italic": return `<i>${value}</i>`;
    case "underline": return `<u>${value}</u>`;
    case "strikethrough": return `<s>${value}</s>`;
    case "spoiler": return `<tg-spoiler>${value}</tg-spoiler>`;
    case "code": return `<code>${value}</code>`;
    case "pre": return `<pre>${value}</pre>`;
    default: return value;
  }
}

function formatStoredDescription(value: string): string {
  if (value.startsWith("[[TELEGRAM_HTML]]")) return value.slice("[[TELEGRAM_HTML]]".length);
  return escapeHtml(value);
}

export function subgroupLabel(subgroup: HomeworkSubgroup): string {
  if (subgroup === "GROUP_1") return "1 подгруппа";
  if (subgroup === "GROUP_2") return "2 подгруппа";
  return "Все";
}

export function formatDeadline(deadline: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(deadline.getUTCDate())}.${pad(deadline.getUTCMonth() + 1)}.${deadline.getUTCFullYear()} ${pad(deadline.getUTCHours())}:${pad(deadline.getUTCMinutes())}`;
}

function capMessage(value: string): string {
  if (value.length <= TELEGRAM_MESSAGE_LIMIT) return value;
  return `${value.slice(0, TELEGRAM_MESSAGE_LIMIT - 40)}\n… сообщение сокращено.`;
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

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function unescapeHtml(value: string): string {
  return value.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}
