import { CreateUser } from './createUser.dto';
import { PartialType } from '@nestjs/swagger';

export class EditUser extends PartialType(CreateUser) {}
