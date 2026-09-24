import { PartialType } from '@nestjs/swagger';
import { CreateRoute } from './createRoute.dto';

export class EditRoute extends PartialType(CreateRoute) {}
