# Homework Telegram Bot

Telegram-бот для ведения домашнего задания внутри Telegram Topics.

## Возможности

- отдельный список ДЗ для каждой пары `chat_id + message_thread_id`;
- команды принимаются только из сообщений Telegram supergroup с Topics;
- каждое изменение ДЗ привязано одновременно к `chat_id` и `message_thread_id`;
- `user_id` определяется для каждой команды, а автор `/add` сохраняется в БД;
- ровно один `HomeworkList` на каждый topic благодаря уникальному ограничению БД;
- одно основное сообщение со списком ДЗ на каждый topic;
- после `/add`, `/edit`, `/delete` и `/done` существующее основное сообщение редактируется, а не создаётся заново;
- `primaryMessageId` сохраняется в БД и переживает перезапуск бота;
- если сохранённое сообщение было удалено, старый `message_id` сбрасывается и создаётся новое основное сообщение;
- обновления одного topic проходят через последовательную очередь;
- HTML-символы в тексте ДЗ экранируются перед отправкой с `parse_mode: HTML`;
- форматтер учитывает лимит Telegram в 4096 символов;
- у ДЗ можно указать deadline, который хранится в PostgreSQL и отображается в основном сообщении;
- просроченные ДЗ автоматически помечаются как архивные и исчезают из активного списка;
- архивные ДЗ не удаляются из базы данных;
- архивирование защищено условным `updateMany`, поэтому параллельные процессы не архивируют одну запись дважды;
- хранение Telegram-групп, topics, пользователей, авторов заданий и дат создания/изменения;
- `/add`, `/edit`, `/delete`, `/list`, `/done` с проверкой синтаксиса;
- `/done` идемпотентен;
- ошибки БД и Telegram API перехватываются на уровне команды;
- PostgreSQL + Prisma вместо JSON-файла;
- уникальные ограничения и транзакционные upsert-операции защищают создание group/topic/list от дублей при конкурентных запросах.

## Deadline и часовой пояс

Deadline вводится в формате UTC:

```text
ДД.ММ.ГГГГ ЧЧ:ММ UTC
```

Например:

```text
/add Решить задачи 1-10 | 25.09.2026 23:59
```

В базе deadline хранится как UTC `DateTime`. В основном сообщении он также показывается с суффиксом `UTC`. Это поведение не зависит от часового пояса Render.

Deadline необязателен для обратной совместимости с существующими `/add`: команда `/add <текст>` продолжает работать. Для таких заданий автоматического архивирования по сроку нет.

Автоматическая проверка просроченных заданий выполняется каждые 30 секунд и также запускается при старте приложения.

## Требования

- Node.js 22+
- PostgreSQL
- Telegram Bot Token

## Local development

Установить зависимости и создать локальный `.env`:

```bash
npm install
cp .env.example .env
```

Для локального запуска используйте PostgreSQL и укажите в `.env`:

```env
BOT_TOKEN=123456:your-token
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/homework_bot?schema=public
NODE_ENV=development
WEBHOOK_SECRET=
```

Применить миграции:

```bash
npx prisma migrate dev
```

Запуск в разработке:

```bash
npm run dev
```

Локально бот использует long polling. При запуске на Render автоматически используется webhook.

### Проверки

```bash
npm run build
npm test
```

Production-запуск локально после сборки:

```bash
npm start
```

Для `npm start` нужны корректные `BOT_TOKEN` и `DATABASE_URL`.

## Production

Сборка:

```bash
npm run build
```

Запуск собранного JavaScript:

```bash
npm start
```

Применение production-миграций:

```bash
npm run prisma:deploy
```

На Render production максимально упрощён: `render.yaml` выполняет `prisma migrate deploy` во время build, затем `npm start` запускает собранный JavaScript.

## Deploy to Render

Для бесплатного Render Web Service бот использует webhook, а не long polling. Render Free Web Service должен принимать HTTP-запросы и слушать порт `PORT`; кроме того, бесплатный сервис может остановиться после периода без входящего трафика. Webhook Telegram соответствует модели Web Service: Telegram отправляет обновления на HTTP endpoint бота. Render автоматически предоставляет публичный `RENDER_EXTERNAL_URL`, поэтому URL webhook не нужно добавлять в `.env`.

### 1. Создать PostgreSQL в Neon

1. Создайте проект в Neon.
2. Создайте production database.
3. Скопируйте connection string PostgreSQL.
4. Убедитесь, что строка указывает на Neon, а не на `localhost`.

### 2. Создать Render Web Service

1. Откройте Render.
2. Выберите **New → Web Service**.
3. Подключите GitHub repository `Loran-frontend/homework-tg-bot`.
4. Выберите ветку `main`.
5. План — **Free**.
6. Если Render предлагает Blueprint из `render.yaml`, можно использовать его. В противном случае задайте параметры вручную.

Параметры:

```text
Build Command:
npm install --include=dev && npm run prisma:deploy && npm run build

Start Command:
npm start

Health Check Path:
/health
```

### 3. Environment Variables

Добавьте в Render:

```text
BOT_TOKEN=<токен Telegram-бота>
DATABASE_URL=<connection string из Neon>
NODE_ENV=production
WEBHOOK_SECRET=<случайная строка из A-Z/a-z/0-9/_/->
```

`BOT_TOKEN`, `DATABASE_URL` и `WEBHOOK_SECRET` не должны попадать в GitHub.

`WEBHOOK_SECRET` используется для проверки заголовка `X-Telegram-Bot-Api-Secret-Token`. Telegram поддерживает secret token для webhook, а grammY проверяет его на стороне webhook handler.

### 4. Deploy

После сохранения переменных Render выполнит:

```text
npm install --include=dev
npm run prisma:deploy
npm run build
npm start
```

`prisma migrate deploy` применяет только уже созданные production migrations. Новые миграции нужно создавать локально через `prisma migrate dev`, проверять и коммитить в Git.

### 5. Telegram webhook

При запуске на Render приложение автоматически определяет Render по `RENDER=true`, берёт публичный адрес из `RENDER_EXTERNAL_URL` и устанавливает webhook:

```text
https://<render-service>.onrender.com/telegram/webhook
```

`bot.start()` на Render не вызывается, поэтому polling и webhook не запускаются одновременно.

### 6. Проверка

После успешного deploy:

1. Откройте в Render страницу сервиса.
2. Проверьте, что health check `/health` возвращает HTTP 200.
3. Проверьте логи — не должно быть ошибок `BOT_TOKEN`, `DATABASE_URL`, `WEBHOOK_SECRET` или Prisma.
4. Добавьте бота в Telegram supergroup с Topics.
5. Проверьте `/start`, `/add`, `/list`, `/edit`, `/done`, `/delete` в нужном topic.
6. Для проверки deadline добавьте ДЗ с ближайшим сроком и убедитесь, что после него запись исчезает из основного сообщения, но остаётся в БД как архивная.
7. Проверьте, что разные topics и группы имеют независимые списки ДЗ.

## Команды

```text
/add Математика — решить №1–10 | 25.09.2026 23:59
/add Математика — прочитать параграф
/edit 1 Математика — решить №11–20
/delete 1
/list
/done 1
```

Команды должны отправляться в тот topic, к которому относится список. Один и тот же номер задания в разных topics считается разными записями: операции выполняются только внутри текущего `chat_id + message_thread_id`.

## Модель данных

```text
TelegramGroup
  └── Topic (unique: groupId + messageThreadId)
        └── HomeworkList (unique: topicId)
              └── HomeworkItem ──> TelegramUser (author)
                                  ├── deadline
                                  └── archived
```

`TelegramGroup.chatId` и `TelegramUser.telegramId` хранятся как PostgreSQL `BIGINT`, а `Topic.messageThreadId` и `HomeworkList.primaryMessageId` — как `INTEGER`.

## Health endpoint

Render Web Service обслуживает:

```text
GET /health
```

Ответ:

```json
{
  "status": "ok"
}
```

Endpoint не зависит от Telegram API и используется только для проверки доступности сервиса.

## Важно для Telegram

Боту нужны права, позволяющие отправлять сообщения и редактировать свои сообщения в группе. Для работы с Topics группа должна быть супергруппой с включёнными темами.

## Безопасность

- `.env` и другие `.env.*` файлы игнорируются Git, кроме `.env.example`;
- секреты не хранятся в исходном коде;
- токен Telegram не выводится в логах;
- `DATABASE_URL` не выводится в логах;
- webhook защищён `WEBHOOK_SECRET`;
- ошибки пользователю не раскрывают содержимое секретных environment variables.
