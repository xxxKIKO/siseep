import { Global, Module } from '@nestjs/common';
import { AuditDescriber } from './audit-describer';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditDescriber],
  exports: [AuditService],
})
export class AuditModule {}
