# Homework Telegram Bot

Telegram-бот для ведения домашнего задания внутри Telegram Topics.

## Возможности

- отдельный список ДЗ для каждой пары `chat_id + message_thread_id`;
- ровно один `HomeworkList` на каждый topic благодаря уникальному ограничению БД;
- одно основное сообщение со списком ДЗ на каждый topic;
- хранение Telegram-групп, topics, пользователей, авторов заданий и дат создания/изменения;
- атомарное переключение статуса выполнения;
- `/add`, `/edit`, `/delete`, `/list`, `/done`;
- PostgreSQL + Prisma вместо JSON-файла;
- уникальные ограничения и транзакционные upsert-операции защищают создание group/topic/list от дублей при конкурентных запросах.

## Запуск

Требуется Node.js 22+ и PostgreSQL.

```bash
npm install
cp .env.example .env
```

В `.env` укажите токен бота и строку подключения PostgreSQL:

```env
BOT_TOKEN=123456:your-token
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/homework_bot?schema=public
```

Применить миграции:

```bash
npm run prisma:deploy
```

Запуск в разработке:

```bash
npm run dev
```

Сборка и проверка TypeScript:

```bash
npm run build
```

## Команды

```text
/add Математика — решить №1–10
/edit 1 Математика — решить №11–20
/delete 1
/list
/done 1
```

Команды должны отправляться в тот topic, к которому относится список.

## Модель данных

```text
TelegramGroup
  └── Topic (unique: groupId + messageThreadId)
        └── HomeworkList (unique: topicId)
              └── HomeworkItem ──> TelegramUser (author)
```

`TelegramGroup.chatId` и `TelegramUser.telegramId` хранятся как PostgreSQL `BIGINT`, а `Topic.messageThreadId` и `HomeworkList.primaryMessageId` — как `INTEGER`.

## Важно для Telegram

Боту нужны права, позволяющие отправлять сообщения и редактировать свои сообщения в группе. Для работы с Topics группа должна быть супергруппой с включёнными темами.
