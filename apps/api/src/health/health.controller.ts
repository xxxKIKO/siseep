import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Connection } from 'mongoose';
import { Public } from '../common/decorators';
import { AppConfigService } from '../config/app-config.service';
import { findChromium } from '../reports/pdf.service';

export interface HealthView {
  status: 'ok';
  db: 'up';
  pdf: 'ready' | 'unavailable';
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Healthcheck of Railway/Render: MongoDB connected and Chromium available for the report cards.
   * In staging/production a missing Chromium is a failure (no report cards = not ready).
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Estado de la API, la base de datos y el generador de PDF' })
  async check(): Promise<HealthView> {
    // readyState 1 = connected; ping confirms the server answers.
    if (this.connection.readyState !== 1) throw new ServiceUnavailableException();
    try {
      await this.connection.db!.admin().ping();
    } catch {
      throw new ServiceUnavailableException();
    }
    const pdf = findChromium(this.config.get('CHROMIUM_PATH')) ? 'ready' : 'unavailable';
    if (pdf === 'unavailable' && this.config.isProductionLike) {
      throw new ServiceUnavailableException();
    }
    return { status: 'ok', db: 'up', pdf };
  }
}
