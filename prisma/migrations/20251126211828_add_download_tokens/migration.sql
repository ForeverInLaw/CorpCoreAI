-- CreateTable
CREATE TABLE "DownloadToken" (
    "token" TEXT NOT NULL,
    "attachmentId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DownloadToken_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE INDEX "DownloadToken_attachmentId_idx" ON "DownloadToken"("attachmentId");

-- CreateIndex
CREATE INDEX "DownloadToken_expiresAt_idx" ON "DownloadToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "DownloadToken" ADD CONSTRAINT "DownloadToken_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
