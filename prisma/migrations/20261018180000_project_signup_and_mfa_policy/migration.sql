-- CreateEnum
CREATE TYPE "SignupPolicy" AS ENUM ('CLOSED', 'OPEN');

-- CreateEnum
CREATE TYPE "MfaPolicy" AS ENUM ('REQUIRED', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "AccountEmailKind" AS ENUM ('SIGNUP', 'PASSWORD_RESET', 'ACCOUNT_EXISTS', 'PASSWORD_CHANGED');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "defaultRoleId" TEXT,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "logo" TEXT,
ADD COLUMN     "mfaPolicy" "MfaPolicy" NOT NULL DEFAULT 'REQUIRED',
ADD COLUMN     "signupPolicy" "SignupPolicy" NOT NULL DEFAULT 'CLOSED';

-- AlterTable
ALTER TABLE "AuthSession" ADD COLUMN     "singleFactor" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AccountEmail" (
    "id" TEXT NOT NULL,
    "kind" "AccountEmailKind" NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "projectId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountEmail_tokenHash_key" ON "AccountEmail"("tokenHash");

-- CreateIndex
CREATE INDEX "AccountEmail_email_createdAt_idx" ON "AccountEmail"("email", "createdAt");

-- CreateIndex
CREATE INDEX "AccountEmail_userId_idx" ON "AccountEmail"("userId");

-- CreateIndex
CREATE INDEX "AccountEmail_projectId_idx" ON "AccountEmail"("projectId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_defaultRoleId_fkey" FOREIGN KEY ("defaultRoleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountEmail" ADD CONSTRAINT "AccountEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountEmail" ADD CONSTRAINT "AccountEmail_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

