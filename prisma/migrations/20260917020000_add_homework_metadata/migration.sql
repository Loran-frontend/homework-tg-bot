-- Add metadata required by the IRNITU/MIPT homework flow.
ALTER TABLE "HomeworkItem"
  ADD COLUMN "subject" TEXT NOT NULL DEFAULT 'Вычислительная математика',
  ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "subgroup" "HomeworkSubgroup" NOT NULL DEFAULT 'ALL';

-- Preserve existing homework text as the new description field.
UPDATE "HomeworkItem" SET "description" = "text";
ALTER TABLE "HomeworkItem" DROP COLUMN "text";
