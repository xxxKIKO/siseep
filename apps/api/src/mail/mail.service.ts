import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { AppConfigService } from '../config/app-config.service';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Sends transactional email. Abstract so tests can swap in a fake. */
export abstract class MailService {
  abstract send(message: MailMessage): Promise<void>;
}

/** Local development: prints the email to the log instead of sending it. */
@Injectable()
export class ConsoleMailService extends MailService {
  private readonly logger = new Logger('Mail');

  async send(message: MailMessage): Promise<void> {
    this.logger.log(
      `\n--- Correo (no se envía en local) ---\nPara: ${message.to}\nAsunto: ${message.subject}\n\n${message.text}\n------------------------------------`,
    );
  }
}

/** Staging and production: sends through Resend. */
@Injectable()
export class ResendMailService extends MailService {
  private readonly logger = new Logger('Mail');
  private readonly client: Resend;

  constructor(private readonly config: AppConfigService) {
    super();
    this.client = new Resend(config.get('RESEND_API_KEY'));
  }

  async send(message: MailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.config.get('MAIL_FROM'),
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
    if (error) {
      // Log only the error name: the recipient is personal data.
      this.logger.error(`No se pudo enviar el correo: ${error.name}`);
      throw new Error('MAIL_SEND_FAILED');
    }
  }
}
