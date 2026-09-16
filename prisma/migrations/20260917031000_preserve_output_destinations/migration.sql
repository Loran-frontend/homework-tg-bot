INSERT INTO "OutputMessage" ("messageType", "messageId", "destinationChatId", "createdAt", "updatedAt")
SELECT "messageType", "messageId", "destinationChatId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT ON ("messageType") "messageType", "messageId", "destinationChatId"
    FROM "PersistentMessage"
    WHERE "messageId" > 0
    ORDER BY "messageType", "id" DESC
) AS legacy
ON CONFLICT ("messageType") DO NOTHING;
