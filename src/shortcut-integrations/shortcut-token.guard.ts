import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ShortcutIntegrationsService } from './shortcut-integrations.service';

@Injectable()
export class ShortcutTokenGuard implements CanActivate {
  constructor(
    private readonly shortcutIntegrationsService: ShortcutIntegrationsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-finanzapp-shortcut-token'];
    const rawToken = Array.isArray(header) ? header[0] : header;
    request.shortcutIdentity =
      await this.shortcutIntegrationsService.authenticate(rawToken);
    return true;
  }
}
