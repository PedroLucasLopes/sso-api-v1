import { IsNotEmpty, IsString, IsUUID, Matches } from 'class-validator';
import { ROLE_NAME_PATTERN } from 'src/global/constants/defaultRoles.constant';

export class CreateRole {
  /**
   * Nome livre, como ARQUITETO. Os padroes SUPERADMIN, ADMIN, MANAGER e VIEWER
   * ja nascem em todo projeto.
   */
  @IsString()
  @Matches(ROLE_NAME_PATTERN, {
    message:
      'name must have 2 to 40 characters: an uppercase letter, then uppercase letters, digits or underscores',
  })
  name: string;

  @IsUUID(4, { each: true })
  @IsNotEmpty()
  projectId: string;
}
