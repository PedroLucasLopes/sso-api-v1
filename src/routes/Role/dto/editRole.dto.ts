import { PartialType } from '@nestjs/swagger';
import { CreateRole } from './createRole.dto';

export class EditRole extends PartialType(CreateRole) {}
