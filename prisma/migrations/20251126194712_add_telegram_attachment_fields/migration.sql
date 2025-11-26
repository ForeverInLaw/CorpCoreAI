-- CreateEnum
CREATE TYPE "AttachmentSource" AS ENUM ('TELEGRAM', 'EXTERNAL');

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "sizeBytes" INTEGER,
ADD COLUMN     "source" "AttachmentSource" NOT NULL DEFAULT 'TELEGRAM',
ADD COLUMN     "telegramFileId" TEXT,
ADD COLUMN     "telegramUniqueFileId" TEXT,
ADD COLUMN     "uploadedById" BIGINT;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
