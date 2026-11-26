import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createPermissionGrantSchema, type PermissionGrantView } from '@siseep/shared';
import { createZodDto } from 'nestjs-zod';
import { CheckPolicies, CurrentActor } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import type { Actor } from '../common/request-user';
import { PermissionGrantsService } from './permission-grants.service';

class CreatePermissionGrantDto extends createZodDto(createPermissionGrantSchema) {}

@ApiTags('permission-grants')
@ApiBearerAuth()
@Controller('permission-grants')
@CheckPolicies((ability) => ability.can('manage', 'PermissionGrant'))
export class PermissionGrantsController {
  constructor(private readonly grants: PermissionGrantsService) {}

  @Get()
  @ApiOperation({ summary: 'Permisos especiales de la escuela (solo admin)' })
  list(
    @CurrentActor() actor: Actor,
    @Query('userId') userId?: string,
  ): Promise<PermissionGrantView[]> {
    return this.grants.list(actor, userId && /^[a-f\d]{24}$/i.test(userId) ? userId : undefined);
  }

  @Post()
  @ApiOperation({ summary: 'Otorga un permiso especial' })
  create(
    @Body() dto: CreatePermissionGrantDto,
    @CurrentActor() actor: Actor,
  ): Promise<PermissionGrantView> {
    return this.grants.create(dto, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoca un permiso especial' })
  revoke(@Param('id', ObjectIdPipe) id: string, @CurrentActor() actor: Actor): Promise<void> {
    return this.grants.revoke(id, actor);
  }
}
