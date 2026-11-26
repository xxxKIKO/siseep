import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { ConsoleMailService, MailService, ResendMailService } from './mail.service';

@Global()
@Module({
  providers: [
    {
      provide: MailService,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): MailService =>
        config.get('MAIL_DRIVER') === 'resend'
          ? new ResendMailService(config)
          : new ConsoleMailService(),
    },
  ],
  exports: [MailService],
})
export class MailModule {}
