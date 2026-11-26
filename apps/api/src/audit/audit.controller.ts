import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { auditQuerySchema, type AuditLogView, type Paginated } from '@siseep/shared';
import { createZodDto } from 'nestjs-zod';
import { CheckPolicies, CurrentActor } from '../common/decorators';
import type { Actor } from '../common/request-user';
import { AuditService } from './audit.service';

class AuditQueryDto extends createZodDto(auditQuerySchema) {}

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'AuditLog'))
  @ApiOperation({
    summary: 'Bitácora (?entity=&entityId=&groupId=&from=&to=). Maestro: solo sus grupos',
  })
  list(
    @Query() query: AuditQueryDto,
    @CurrentActor() actor: Actor,
  ): Promise<Paginated<AuditLogView>> {
    return this.audit.list(query, actor);
  }
}
