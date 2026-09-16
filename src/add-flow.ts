import type { HomeworkSubgroup, HomeworkType } from "./types.js";

export type ParsedAddCommand = {
  type: HomeworkType;
  subject: string;
  subgroup: HomeworkSubgroup;
  description: string;
  deadline: Date | null;
};

const DEFAULT_SUBJECT = "Вычислительная математика";

export function parseAddCommand(value: string): ParsedAddCommand | null {
  const input = value.trim();
  if (!input) return null;

  const parts = input.split("|").map((part) => part.trim()).filter(Boolean);
  const description = parts[0];
  if (!description || parts.length > 2) return null;

  let deadline: Date | null = null;
  if (parts[1]) {
    const match = parts[1].match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
    if (!match) return null;
    const [, day, month, year, hours, minutes] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes)));
    if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day) || date.getUTCHours() !== Number(hours) || date.getUTCMinutes() !== Number(minutes)) return null;
    deadline = date;
  }

  return { type: "IRNITU", subject: DEFAULT_SUBJECT, subgroup: "ALL", description, deadline };
}
