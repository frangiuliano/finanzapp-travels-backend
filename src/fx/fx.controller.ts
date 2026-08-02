import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FxService } from './fx.service';

@Controller('fx')
@UseGuards(JwtAuthGuard)
export class FxController {
  constructor(private readonly fxService: FxService) {}

  @Get('rate')
  async getRate(
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<{
    from: string;
    to: string;
    rate: number;
    capturedAt: string;
    providerEnabled: boolean;
    provider: string;
    argentinaCasa?: string;
  }> {
    const snapshot = await this.fxService.resolveSnapshot(from, to);
    const isUsdArs =
      (from === 'USD' && to === 'ARS') || (from === 'ARS' && to === 'USD');

    return {
      from,
      to,
      rate: snapshot.fxRateToBoardCurrency,
      capturedAt: snapshot.fxCapturedAt.toISOString(),
      providerEnabled: this.fxService.isProviderEnabled(),
      provider: isUsdArs ? 'dolarapi' : 'exchangerate-api',
      ...(isUsdArs ? { argentinaCasa: this.fxService.getArgentinaCasa() } : {}),
    };
  }
}
