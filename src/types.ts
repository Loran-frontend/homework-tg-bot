export interface HomeworkItem {
  id: number;
  text: string;
  completed: boolean;
}

export interface TopicHomework {
  chatId: number;
  threadId: number;
  messageId?: number;
  items: HomeworkItem[];
}

export interface HomeworkDatabase {
  topics: Record<string, TopicHomework>;
}
