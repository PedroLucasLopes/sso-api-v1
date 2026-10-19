import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { ApiException } from '../error/apiError';
import {
  SMTP_MIN_TLS_VERSION,
  SMTP_TIMEOUTS_MS,
  TRANSACTIONAL_HEADERS,
} from './mail.constant';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class MailerService implements OnModuleDestroy {
  private readonly transporter: Transporter | null;
  private readonly from: string;
  private readonly replyTo: string | undefined;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST', '').trim();

    this.from = config.get<string>('MAIL_FROM', '').trim();
    this.replyTo = config.get<string>('MAIL_REPLY_TO', '').trim() || undefined;

    if (!host) {
      this.transporter = null;
      return;
    }

    if (!this.from) {
      throw new Error('SMTP_HOST exige MAIL_FROM, o remetente dos e-mails');
    }

    const user = config.get<string>('SMTP_USER', '').trim();
    const password = config.get<string>('SMTP_PASSWORD', '');

    this.transporter = createTransport({
      host,
      port: Number(config.get<string>('SMTP_PORT', '587')),
      secure: config.get<string>('SMTP_SECURE', 'false').trim() === 'true',
      requireTLS:
        config.get<string>('SMTP_REQUIRE_TLS', 'true').trim() !== 'false',
      auth: user && password ? { user, pass: password } : undefined,
      tls: { minVersion: SMTP_MIN_TLS_VERSION },
      connectionTimeout: SMTP_TIMEOUTS_MS.connection,
      greetingTimeout: SMTP_TIMEOUTS_MS.greeting,
      socketTimeout: SMTP_TIMEOUTS_MS.socket,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  get available(): boolean {
    return this.transporter !== null;
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transporter) throw new ApiException('email_unavailable');

    await this.transporter.sendMail({
      from: this.from,
      replyTo: this.replyTo,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: { ...TRANSACTIONAL_HEADERS },
    });
  }

  onModuleDestroy(): void {
    this.transporter?.close();
  }
}
