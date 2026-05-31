-- AlterTable: Add CASCADE delete to Task child tables
ALTER TABLE "TaskAssignment" DROP CONSTRAINT "TaskAssignment_taskId_fkey",
    ADD CONSTRAINT "TaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskTag" DROP CONSTRAINT "TaskTag_taskId_fkey",
    ADD CONSTRAINT "TaskTag_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskProject" DROP CONSTRAINT "TaskProject_taskId_fkey",
    ADD CONSTRAINT "TaskProject_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_taskId_fkey",
    ADD CONSTRAINT "Attachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskHistory" DROP CONSTRAINT "TaskHistory_taskId_fkey",
    ADD CONSTRAINT "TaskHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex: Add indexes for Task query performance
CREATE INDEX "Task_creatorId_idx" ON "Task"("creatorId");
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");
CREATE INDEX "Task_status_idx" ON "Task"("status");
CREATE INDEX "Task_deadline_idx" ON "Task"("deadline");

-- CreateIndex: Add index for Attachment query performance
CREATE INDEX "Attachment_taskId_idx" ON "Attachment"("taskId");
