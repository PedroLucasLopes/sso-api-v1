import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { UserService } from '../Service/user.service';
import { User } from 'generated/prisma/client';
import { FilterUser } from '../dto/filterUser.dto';
import { CreateUser } from '../dto/createUser.dto';
import { EditUser } from '../dto/editUser.dto';

@Controller('user')
export class UserController {
  constructor(private userService: UserService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() filter: FilterUser): Promise<User[]> {
    return await this.userService.findAll(filter);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findById(@Param('id') id: string): Promise<User> {
    return await this.userService.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createUser(@Body() data: CreateUser): Promise<User> {
    return await this.userService.createUser(data);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async updateUser(
    @Param('id') id: string,
    @Body() data: EditUser,
  ): Promise<User> {
    return await this.userService.updateUser(id, data);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUser(@Param('id') id: string) {
    return await this.userService.deleteUser(id);
  }
}
