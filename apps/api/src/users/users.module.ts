import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MeController } from './me.controller';
import { User, UserSchema } from './user.schema';
import { UsersService } from './users.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  controllers: [MeController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
