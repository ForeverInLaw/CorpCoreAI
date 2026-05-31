-- CreateIndex: Add index for User role filtering
CREATE INDEX "User_role_idx" ON "User"("role");

-- AlterTable: Add CASCADE delete to DownloadToken
ALTER TABLE "DownloadToken" DROP CONSTRAINT "DownloadToken_attachmentId_fkey",
    ADD CONSTRAINT "DownloadToken_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
