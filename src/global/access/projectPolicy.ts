import { MfaPolicy, SignupPolicy } from 'generated/prisma/enums';
import { SSO_SELF_PROJECT_NAME } from '../constants/selfProject.constant';

export interface ProjectAccessPolicy {
  id: string;
  name: string;
  signupPolicy: SignupPolicy;
  mfaPolicy: MfaPolicy;
  defaultRoleId: string | null;
}

export const PROJECT_ACCESS_POLICY_FIELDS = {
  id: true,
  name: true,
  signupPolicy: true,
  mfaPolicy: true,
  defaultRoleId: true,
} as const;

export function acceptsSignup(project: ProjectAccessPolicy): boolean {
  return (
    project.name !== SSO_SELF_PROJECT_NAME &&
    project.signupPolicy === SignupPolicy.OPEN &&
    project.defaultRoleId !== null
  );
}

export function enteringRole(
  project: ProjectAccessPolicy,
  membershipRoleId: string | null,
  blocked = false,
): string | null {
  if (membershipRoleId) return membershipRoleId;

  return acceptsSignup(project) && !blocked ? project.defaultRoleId : null;
}

export function secondFactorOptional(
  project: ProjectAccessPolicy,
  roleId: string | null,
): boolean {
  return (
    project.name !== SSO_SELF_PROJECT_NAME &&
    project.mfaPolicy === MfaPolicy.OPTIONAL &&
    project.defaultRoleId !== null &&
    roleId === project.defaultRoleId
  );
}
