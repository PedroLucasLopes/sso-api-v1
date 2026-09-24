import { PartialType } from '@nestjs/swagger';
import { CreateRedirectUri } from './createRedirectUri.dto';

export class EditRedirectUri extends PartialType(CreateRedirectUri) {}
