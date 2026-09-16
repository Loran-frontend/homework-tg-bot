-- Add separate IRNITU/MIPT homework lists while preserving existing records.
CREATE TYPE "HomeworkType" AS ENUM ('IRNITU', 'MIPT');
CREATE TYPE "HomeworkSubgroup" AS ENUM ('ALL', 'GROUP_1', 'GROUP_2');

ALTER TABLE "HomeworkList" ADD COLUMN "type" "HomeworkType" NOT NULL DEFAULT 'IRNITU';
DROP INDEX "HomeworkList_topicId_key";
CREATE UNIQUE INDEX "HomeworkList_topicId_type_key" ON "HomeworkList"("topicId", "type");
CREATE INDEX "HomeworkList_topicId_idx" ON "HomeworkList"("topicId");

ALTER TABLE "TelegramUser" ADD COLUMN "subgroup" "HomeworkSubgroup";
