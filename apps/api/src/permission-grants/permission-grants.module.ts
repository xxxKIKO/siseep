import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PermissionGrant, PermissionGrantSchema } from './permission-grant.schema';
import { PermissionGrantsService } from './permission-grants.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: PermissionGrant.name, schema: PermissionGrantSchema }]),
  ],
  providers: [PermissionGrantsService],
  exports: [PermissionGrantsService],
})
export class PermissionGrantsModule {}
