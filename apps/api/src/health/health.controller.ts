import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Connection } from 'mongoose';
import { Public } from '../common/decorators';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Estado de la API y de la base de datos (para el healthcheck)' })
  check(): { status: 'ok'; db: 'up' } {
    // readyState 1 = connected
    if (this.connection.readyState !== 1) throw new ServiceUnavailableException();
    return { status: 'ok', db: 'up' };
  }
}
