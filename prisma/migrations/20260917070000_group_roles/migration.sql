ALTER TABLE "TelegramGroup" ADD COLUMN "ownerTelegramId" BIGINT;

CREATE TYPE "GroupRole" AS ENUM ('ADMIN');

CREATE TABLE "TelegramGroupRole" (
  "id" SERIAL NOT NULL,
  "groupId" INTEGER NOT NULL,
  "telegramId" BIGINT NOT NULL,
  "role" "GroupRole" NOT NULL DEFAULT 'ADMIN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelegramGroupRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramGroupRole_groupId_telegramId_key" ON "TelegramGroupRole"("groupId", "telegramId");
CREATE INDEX "TelegramGroupRole_telegramId_idx" ON "TelegramGroupRole"("telegramId");

ALTER TABLE "TelegramGroupRole"
  ADD CONSTRAINT "TelegramGroupRole_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
