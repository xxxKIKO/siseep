import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type Paginated, updateUserSchema, type User, userListQuerySchema } from '@siseep/shared';
import { createZodDto } from 'nestjs-zod';
import { CheckPolicies, CurrentActor } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import type { Actor } from '../common/request-user';
import { UsersAdminService } from './users-admin.service';

class UpdateUserDto extends createZodDto(updateUserSchema) {}
class UserListQueryDto extends createZodDto(userListQuerySchema) {}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@CheckPolicies((ability) => ability.can('manage', 'User'))
export class UsersAdminController {
  constructor(private readonly users: UsersAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Personas de la escuela (?q=&role=&status=) — admin' })
  list(@Query() query: UserListQueryDto, @CurrentActor() actor: Actor): Promise<Paginated<User>> {
    return this.users.list(query, actor);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cambia nombre o roles' })
  update(
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentActor() actor: Actor,
  ): Promise<User> {
    return this.users.update(id, dto, actor);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desactiva la cuenta y cierra sus sesiones' })
  disable(@Param('id', ObjectIdPipe) id: string, @CurrentActor() actor: Actor): Promise<User> {
    return this.users.disable(id, actor);
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactiva la cuenta' })
  enable(@Param('id', ObjectIdPipe) id: string, @CurrentActor() actor: Actor): Promise<User> {
    return this.users.enable(id, actor);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Envía un enlace para cambiar la contraseña y cierra sus sesiones' })
  resetPassword(
    @Param('id', ObjectIdPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<void> {
    return this.users.forcePasswordReset(id, actor);
  }
}
