# Homework Telegram Bot

Telegram-бот для ведения домашнего задания внутри Telegram Topics.

## Возможности

- отдельный список ДЗ для каждой пары `chat_id + message_thread_id`;
- команды принимаются только из сообщений Telegram supergroup с Topics;
- каждое изменение ДЗ привязано одновременно к `chat_id` и `message_thread_id`, поэтому номер задания из другого topic не изменяется;
- `user_id` определяется для каждой команды, а автор `/add` сохраняется в БД;
- ровно один `HomeworkList` на каждый topic благодаря уникальному ограничению БД;
- одно основное сообщение со списком ДЗ на каждый topic;
- хранение Telegram-групп, topics, пользователей, авторов заданий и дат создания/изменения;
- `/add`, `/edit`, `/delete`, `/list`, `/done` с проверкой синтаксиса;
- `/done` идемпотентен: повторная команда не снимает отметку выполнения;
- ошибки БД и Telegram API перехватываются на уровне команды и не останавливают polling бота;
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

Парсер команд покрыт Node.js tests в `src/bot.test.ts`; тесты можно запускать через `node --import tsx --test src/bot.test.ts`.

## Команды

```text
/add Математика — решить №1–10
/edit 1 Математика — решить №11–20
/delete 1
/list
/done 1
```

Пустые и некорректные аргументы получают сообщение с правильным синтаксисом. Несуществующий номер задания не изменяет данные. Пустой список отображается отдельным сообщением. Повторный `/done` сообщает, что задание уже выполнено.

Команды должны отправляться в тот topic, к которому относится список. Один и тот же номер задания в разных topics считается разными записями: операции выполняются только внутри текущего `chat_id + message_thread_id`.

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
