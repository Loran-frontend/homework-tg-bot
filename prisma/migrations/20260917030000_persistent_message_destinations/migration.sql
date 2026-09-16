ALTER TABLE "PersistentMessage"
ADD COLUMN "destinationChatId" BIGINT;

UPDATE "PersistentMessage" AS pm
SET "destinationChatId" = g."chatId"
FROM "Topic" AS t
JOIN "TelegramGroup" AS g ON g."id" = t."groupId"
WHERE pm."topicId" = t."id";
