-- CreateEnum
CREATE TYPE "TaskHistoryType" AS ENUM (
  'STATUS_CHANGE',
  'DEADLINE_CHANGE',
  'ASSIGNEE_CHANGE',
  'OVERDUE_REASON',
  'TEAM_CHANGE',
  'TAG_CHANGE',
  'PROJECT_CHANGE',
  'REVIEW_STATUS_CHANGE'
);

-- AddEnumColumn: add new column with enum type
ALTER TABLE "TaskHistory" ADD COLUMN "typeNew" "TaskHistoryType";

-- CopyData: cast existing TEXT values to enum
UPDATE "TaskHistory" SET "typeNew" = "type"::"TaskHistoryType";

-- SetNotNull: enforce NOT NULL after data migration
ALTER TABLE "TaskHistory" ALTER COLUMN "typeNew" SET NOT NULL;

-- DropOldColumn
ALTER TABLE "TaskHistory" DROP COLUMN "type";

-- RenameColumn
ALTER TABLE "TaskHistory" RENAME COLUMN "typeNew" TO "type";
