-- Keep homework storage independent from the Telegram topic where a command is sent.
-- chatId=0 is a reserved internal value and is never used as a Telegram destination.
INSERT INTO "TelegramGroup" ("chatId", "title", "createdAt", "updatedAt")
VALUES (0, 'Homework system storage', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("chatId") DO NOTHING;

INSERT INTO "Topic" ("groupId", "messageThreadId", "name", "createdAt", "updatedAt")
SELECT "id", 0, 'Homework system storage', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TelegramGroup"
WHERE "chatId" = 0
ON CONFLICT ("groupId", "messageThreadId") DO NOTHING;

INSERT INTO "HomeworkList" ("topicId", "type", "createdAt", "updatedAt")
SELECT t."id", types."type", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Topic" t
CROSS JOIN (VALUES ('IRNITU'::"HomeworkType"), ('MIPT'::"HomeworkType")) AS types("type")
JOIN "TelegramGroup" g ON g."id" = t."groupId"
WHERE g."chatId" = 0
ON CONFLICT ("topicId", "type") DO NOTHING;

-- Move existing homework to the system lists without changing HomeworkItem IDs,
-- authors, deadlines, archive state, or any other homework data.
UPDATE "HomeworkItem" hi
SET "listId" = target."id"
FROM "HomeworkList" old_list
JOIN "HomeworkList" target ON target."type" = old_list."type"
JOIN "Topic" target_topic ON target_topic."id" = target."topicId"
JOIN "TelegramGroup" target_group ON target_group."id" = target_topic."groupId"
WHERE hi."listId" = old_list."id"
  AND target_group."chatId" = 0
  AND old_list."topicId" <> target."topicId";
