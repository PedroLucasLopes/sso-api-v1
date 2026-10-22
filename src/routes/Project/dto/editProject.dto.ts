import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import {
  LOGO_MAX_DATA_URI_LENGTH,
  PROJECT_DISPLAY_NAME_MAX_LENGTH,
} from '../logo';
import { CreateProject } from './createProject.dto';

export class EditProject extends PartialType(CreateProject) {
  @IsOptional()
  @IsString()
  @MaxLength(PROJECT_DISPLAY_NAME_MAX_LENGTH, {
    context: { code: 'display_name_too_long' },
  })
  displayName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(LOGO_MAX_DATA_URI_LENGTH, { context: { code: 'logo_too_large' } })
  logo?: string | null;
}
