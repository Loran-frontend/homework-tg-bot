-- AlterTable
ALTER TABLE "HomeworkItem" ADD COLUMN "deadline" TIMESTAMP(3),
ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "HomeworkItem_listId_archived_deadline_idx" ON "HomeworkItem"("listId", "archived", "deadline");
