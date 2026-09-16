-- Store exactly two persistent Telegram messages per Topic: ACTIVE and ARCHIVE.
CREATE TYPE "PersistentMessageType" AS ENUM ('ACTIVE', 'ARCHIVE');

CREATE TABLE "PersistentMessage" (
  "id" SERIAL NOT NULL,
  "topicId" INTEGER NOT NULL,
  "messageType" "PersistentMessageType" NOT NULL,
  "messageId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersistentMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PersistentMessage_topicId_messageType_key" ON "PersistentMessage"("topicId", "messageType");
CREATE INDEX "PersistentMessage_topicId_idx" ON "PersistentMessage"("topicId");

ALTER TABLE "PersistentMessage"
  ADD CONSTRAINT "PersistentMessage_topicId_fkey"
  FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve the existing IRNITU primary message, if one already exists.
INSERT INTO "PersistentMessage" ("topicId", "messageType", "messageId", "updatedAt")
SELECT "topicId", 'ACTIVE'::"PersistentMessageType", "primaryMessageId", CURRENT_TIMESTAMP
FROM "HomeworkList"
WHERE "type" = 'IRNITU' AND "primaryMessageId" IS NOT NULL;
