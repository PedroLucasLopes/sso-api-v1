-- CreateTable
CREATE TABLE "UserPassword" (
    "userId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "mustChange" BOOLEAN NOT NULL DEFAULT true,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPassword_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "UserMfa" (
    "userId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "lastStep" INTEGER,
    "recoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMfa_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "UserPassword" ADD CONSTRAINT "UserPassword_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMfa" ADD CONSTRAINT "UserMfa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

