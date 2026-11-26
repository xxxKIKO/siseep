import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfigService } from '../config/app-config.service';
import { InvitationsModule } from '../invitations/invitations.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LOGIN_THROTTLER, LoginThrottlerGuard } from './login-throttler.guard';
import { PasswordReset, PasswordResetSchema } from './password-reset.schema';
import { PasswordService } from './password.service';
import { PoliciesGuard } from './policies.guard';
import { Session, SessionSchema } from './session.schema';
import { SessionsService } from './sessions.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Session.name, schema: SessionSchema },
      { name: PasswordReset.name, schema: PasswordResetSchema },
    ]),
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.get('JWT_ACCESS_SECRET'),
        signOptions: { algorithm: 'HS256' },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        throttlers: [
          {
            name: LOGIN_THROTTLER,
            limit: config.get('THROTTLE_LOGIN_LIMIT'),
            ttl: config.get('THROTTLE_LOGIN_TTL_MS'),
            blockDuration: config.get('THROTTLE_LOGIN_BLOCK_MS'),
          },
        ],
      }),
    }),
    UsersModule,
    InvitationsModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionsService,
    PasswordService,
    LoginThrottlerGuard,
    // Order matters: authentication first, then CASL policies.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PoliciesGuard },
  ],
  exports: [AuthService, SessionsService],
})
export class AuthModule {}
