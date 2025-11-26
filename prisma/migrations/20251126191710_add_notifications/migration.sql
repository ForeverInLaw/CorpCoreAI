-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "deadlineDayNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "lastDailyReminderAt" TIMESTAMP(3),
ADD COLUMN     "lastDeadlineReminderAt" TIMESTAMP(3),
ADD COLUMN     "managerOverdueNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "overdueNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
