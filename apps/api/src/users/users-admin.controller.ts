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
import {
  type CreatedAccountView,
  createStaffSchema,
  type Paginated,
  subject,
  type TemporaryPasswordView,
  updateUserSchema,
  type User,
  userListQuerySchema,
} from '@siseep/shared';
import { createZodDto } from 'nestjs-zod';
import { CheckPolicies, CurrentActor } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import type { Actor } from '../common/request-user';
import { UsersAdminService } from './users-admin.service';

class UpdateUserDto extends createZodDto(updateUserSchema) {}
class UserListQueryDto extends createZodDto(userListQuerySchema) {}
class CreateStaffDto extends createZodDto(createStaffSchema) {}

/**
 * Accounts of the school. Admin: every account. Director: teachers and guardians only (the
 * service enforces it); admins and directors stay with the admin.
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersAdminController {
  constructor(private readonly users: UsersAdminService) {}

  @Get()
  // Every user may read their own account: the list needs read access to the whole school.
  @CheckPolicies((ability, request) =>
    ability.can('read', subject('User', { schoolId: request.user.schoolId })),
  )
  @ApiOperation({ summary: 'Personas de la escuela (?q=&role=&status=)' })
  list(@Query() query: UserListQueryDto, @CurrentActor() actor: Actor): Promise<Paginated<User>> {
    return this.users.list(query, actor);
  }

  @Post()
  @CheckPolicies((ability) => ability.can('create', 'User'))
  @ApiOperation({
    summary: 'Crea una cuenta del personal: usuario (MAE26-0001) y contraseña temporal',
  })
  create(@Body() dto: CreateStaffDto, @CurrentActor() actor: Actor): Promise<CreatedAccountView> {
    return this.users.createStaff(dto, actor);
  }

  @Patch(':id')
  @CheckPolicies((ability) => ability.can('update', 'User'))
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
  @CheckPolicies((ability) => ability.can('update', 'User'))
  @ApiOperation({ summary: 'Desactiva la cuenta (quitar a un maestro) y cierra sus sesiones' })
  disable(@Param('id', ObjectIdPipe) id: string, @CurrentActor() actor: Actor): Promise<User> {
    return this.users.disable(id, actor);
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('update', 'User'))
  @ApiOperation({ summary: 'Reactiva la cuenta' })
  enable(@Param('id', ObjectIdPipe) id: string, @CurrentActor() actor: Actor): Promise<User> {
    return this.users.enable(id, actor);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('update', 'User'))
  @ApiOperation({ summary: 'Genera una contraseña temporal y cierra sus sesiones' })
  resetPassword(
    @Param('id', ObjectIdPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<TemporaryPasswordView> {
    return this.users.resetToTemporary(id, actor);
  }
}
