import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CredentialService } from 'src/routes/auth/Service/credential.service';
import { UserService } from '../Service/user.service';
import { IssuedPassword, UserCredentialView } from '../dto/userCredential.dto';

@Controller('user')
export class UserCredentialController {
  constructor(
    private readonly users: UserService,
    private readonly credentials: CredentialService,
  ) {}

  @Get(':id/credential')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async credential(@Param('id') id: string): Promise<UserCredentialView> {
    const user = await this.users.findById(id);

    return this.credentials.credentialView(user.id);
  }

  @Post(':id/password')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  async issuePassword(@Param('id') id: string): Promise<IssuedPassword> {
    const user = await this.users.findById(id);

    return {
      email: user.email,
      password: await this.credentials.issuePassword(user.id),
    };
  }

  @Delete(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokePassword(@Param('id') id: string): Promise<void> {
    const user = await this.users.findById(id);

    await this.credentials.revokePassword(user.id);
  }

  @Delete(':id/mfa')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetMfa(@Param('id') id: string): Promise<void> {
    const user = await this.users.findById(id);

    await this.credentials.resetMfa(user.id);
  }
}
