import { IsEnum, IsNotEmpty } from 'class-validator';
import { ProjectStatus } from 'generated/prisma/enums';

export class SetProjectStatus {
  @IsEnum(ProjectStatus)
  @IsNotEmpty()
  status: ProjectStatus;
}

export class ProjectOverview {
  id: string;
  name: string;
  status: ProjectStatus;
  clientId: string;
  createdAt: Date;
  activatedAt: Date | null;
  suspendedAt: Date | null;

  redirectUris: string[];

  redirectUriRecords: Array<{ id: string; redirectUri: string }>;

  clientKeys: Array<{
    id: string;
    createdAt: Date;
    expiresAt: Date | null;
    revokedAt: Date | null;
  }>;

  routes: Array<{ id: string; method: string; path: string }>;

  roles: Array<{
    id: string;
    name: string;
    permissions: Array<{
      id: string;
      routeId: string;
      method: string;
      path: string;
    }>;
  }>;

  users: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    grantedRoutes: number;
  }>;
}
