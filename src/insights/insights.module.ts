import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module';
import { ForecastModule } from '../forecast/forecast.module';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';

@Module({
  imports: [ReportsModule, ForecastModule],
  controllers: [InsightsController],
  providers: [InsightsService],
})
export class InsightsModule {}
