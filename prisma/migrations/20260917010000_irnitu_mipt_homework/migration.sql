-- Add the new homework dimensions while preserving existing records.
CREATE TYPE "HomeworkType" AS ENUM ('IRNITU', 'MIPT');
CREATE TYPE "HomeworkSubgroup" AS ENUM ('ALL', 'GROUP_1', 'GROUP_2');

ALTER TABLE "HomeworkList" ADD COLUMN "type" "HomeworkType" NOT NULL DEFAULT 'IRNITU';
DROP INDEX "HomeworkList_topicId_key";
CREATE UNIQUE INDEX "HomeworkList_topicId_type_key" ON "HomeworkList"("topicId", "type");
CREATE INDEX "HomeworkList_topicId_idx" ON "HomeworkList"("topicId");

ALTER TABLE "TelegramUser" ADD COLUMN "subgroup" "HomeworkSubgroup";

ALTER TABLE "HomeworkItem" ADD COLUMN "subject" TEXT NOT NULL DEFAULT 'Вычислительная математика';
ALTER TABLE "HomeworkItem" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HomeworkItem" ADD COLUMN "subgroup" "HomeworkSubgroup" NOT NULL DEFAULT 'ALL';
ALTER TABLE "HomeworkItem" ADD COLUMN "deadline" TIMESTAMP(3);
ALTER TABLE "HomeworkItem" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

UPDATE "HomeworkItem" SET "description" = "text";
ALTER TABLE "HomeworkItem" DROP COLUMN "text";

CREATE INDEX "HomeworkItem_deadline_archived_idx" ON "HomeworkItem"("deadline", "archived");
