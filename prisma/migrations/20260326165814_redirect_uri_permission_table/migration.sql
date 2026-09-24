/*
  Warnings:

  - You are about to drop the column `allowedRedirectUris` on the `Project` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Project" DROP COLUMN "allowedRedirectUris";

-- CreateTable
CREATE TABLE "redirectUri" (
    "id" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "redirectUri_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "redirectUri_projectId_idx" ON "redirectUri"("projectId");

-- AddForeignKey
ALTER TABLE "redirectUri" ADD CONSTRAINT "redirectUri_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
