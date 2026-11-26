import { Global, Module } from '@nestjs/common';
import { PermissionGrantsModule } from '../permission-grants/permission-grants.module';
import { AbilityFactory } from './ability.factory';

@Global()
@Module({
  imports: [PermissionGrantsModule],
  providers: [AbilityFactory],
  exports: [AbilityFactory],
})
export class AccessModule {}
