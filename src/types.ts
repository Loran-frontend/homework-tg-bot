export interface TelegramUserInput {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface HomeworkItem {
  id: number;
  text: string;
  completed: boolean;
  authorId: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TopicHomework {
  chatId: number;
  threadId: number;
  messageId?: number;
  items: HomeworkItem[];
}
