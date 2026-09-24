import { PartialType } from '@nestjs/swagger';
import { CreateProject } from './createProject.dto';

export class EditProject extends PartialType(CreateProject) {}
