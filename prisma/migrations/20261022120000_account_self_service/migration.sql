-- AlterEnum
ALTER TYPE "AccountEmailKind" ADD VALUE 'ACCOUNT_DELETION';

-- CreateTable
CREATE TABLE "ProjectBlock" (
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBlock_pkey" PRIMARY KEY ("userId","projectId")
);

-- CreateTable
CREATE TABLE "DeletedAccount" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeletedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectBlock_projectId_idx" ON "ProjectBlock"("projectId");

-- CreateIndex
CREATE INDEX "DeletedAccount_projectId_deletedAt_id_idx" ON "DeletedAccount"("projectId", "deletedAt", "id");

-- CreateIndex
CREATE INDEX "DeletedAccount_deletedAt_idx" ON "DeletedAccount"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeletedAccount_projectId_subject_key" ON "DeletedAccount"("projectId", "subject");

-- AddForeignKey
ALTER TABLE "ProjectBlock" ADD CONSTRAINT "ProjectBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBlock" ADD CONSTRAINT "ProjectBlock_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletedAccount" ADD CONSTRAINT "DeletedAccount_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
