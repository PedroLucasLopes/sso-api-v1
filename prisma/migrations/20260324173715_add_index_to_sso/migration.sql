-- CreateIndex
CREATE INDEX "Permission_roleId_routeId_idx" ON "Permission"("roleId", "routeId");

-- CreateIndex
CREATE INDEX "ProjectUser_projectId_roleId_idx" ON "ProjectUser"("projectId", "roleId");

-- CreateIndex
CREATE INDEX "Route_projectId_idx" ON "Route"("projectId");
