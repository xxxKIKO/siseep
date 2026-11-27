import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PasswordService } from '../auth/password.service';
import { MeController } from './me.controller';
import { ProfileService } from './profile.service';
import { User, UserSchema } from './user.schema';
import { UsersService } from './users.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  controllers: [MeController],
  providers: [UsersService, ProfileService, PasswordService],
  exports: [UsersService, PasswordService],
})
export class UsersModule {}
