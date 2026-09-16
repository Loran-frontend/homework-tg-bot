export type HomeworkType = "IRNITU" | "MIPT";
export type HomeworkSubgroup = "ALL" | "GROUP_1" | "GROUP_2";

export interface TelegramUserInput {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface HomeworkItem {
  id: number;
  type: HomeworkType;
  subject: string;
  description: string;
  subgroup: HomeworkSubgroup;
  deadline: Date | null;
  archived: boolean;
  completed: boolean;
  authorId: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TopicHomework {
  chatId: number;
  threadId: number;
  type: HomeworkType;
  messageId?: number;
  items: HomeworkItem[];
}
