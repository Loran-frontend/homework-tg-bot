-- Store the destination Topic together with each topic's persistent ACTIVE/ARCHIVE message.
ALTER TABLE "PersistentMessage"
  ADD COLUMN "destinationThreadId" INTEGER;

-- Preserve thread information from the previous global destination table when
-- it matches an existing per-topic destination.
UPDATE "PersistentMessage" AS pm
SET "destinationThreadId" = omd."destinationThreadId"
FROM "OutputMessageDestination" AS omd
WHERE pm."messageType" = omd."messageType"
  AND pm."destinationChatId" = omd."destinationChatId"
  AND omd."destinationThreadId" IS NOT NULL;

-- A message that was previously configured for its own source chat keeps its
-- source Topic. External chat destinations without a known thread remain at
-- NULL and therefore target the chat's general conversation.
UPDATE "PersistentMessage" AS pm
SET "destinationThreadId" = t."messageThreadId"
FROM "Topic" AS t
JOIN "TelegramGroup" AS g ON g."id" = t."groupId"
WHERE pm."topicId" = t."id"
  AND pm."destinationChatId" = g."chatId"
  AND pm."destinationThreadId" IS NULL;
