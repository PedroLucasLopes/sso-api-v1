import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { MAINTENANCE_INTERVAL_MINUTES } from '../account.constant';
import { AccountEmailService } from './accountEmail.service';
import { AuthorizationCodeService } from './authorizationCode.service';
import { AuthSessionService } from './authSession.service';
import { DeletedAccountService } from './deletedAccount.service';

export interface MaintenanceReport {
  accountEmails: number;
  authorizationCodes: number;
  authSessions: number;
  deletedAccounts: number;
}

@Injectable()
export class MaintenanceService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MaintenanceService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly accountEmails: AccountEmailService,
    private readonly codes: AuthorizationCodeService,
    private readonly sessions: AuthSessionService,
    private readonly deletedAccounts: DeletedAccountService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(
      () => void this.run(),
      MAINTENANCE_INTERVAL_MINUTES * 60 * 1000,
    );
    this.timer.unref();

    void this.run();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);

    this.timer = null;
  }

  async run(): Promise<MaintenanceReport | null> {
    if (this.running) return null;

    this.running = true;

    try {
      const report: MaintenanceReport = {
        accountEmails: await this.accountEmails.purgeStale(),
        authorizationCodes: await this.codes.purgeExpired(),
        authSessions: await this.sessions.purgeExpired(),
        deletedAccounts: await this.deletedAccounts.purgeExpired(),
      };

      if (Object.values(report).some((count) => count > 0)) {
        this.logger.log(
          `limpeza de linhas vencidas: ${JSON.stringify(report)}`,
        );
      }

      return report;
    } catch (error) {
      this.logger.error(
        `limpeza de linhas vencidas falhou: ${error instanceof Error ? error.message : String(error)}`,
      );

      return null;
    } finally {
      this.running = false;
    }
  }
}
