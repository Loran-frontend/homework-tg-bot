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
  return `${item.id}. ${mark} <b>${escapeHtml(item.subject)}</b>\n${escapeHtml(item.description)}\n👥 ${subgroupLabel(item.subgroup)}${deadline}${archived}`;
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
