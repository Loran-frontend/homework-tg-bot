import type { TopicHomework } from "./types.js";

export function formatHomework(topic: TopicHomework): string {
  const lines = ["📚 <b>Домашние задания</b>", ""];

  if (topic.items.length === 0) {
    lines.push("Пока домашних заданий нет.");
    return lines.join("\n");
  }

  for (const item of topic.items) {
    const mark = item.completed ? "✅" : "⬜";
    lines.push(`${item.id}. ${mark} ${escapeHtml(item.text)}`);
  }

  return lines.join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
