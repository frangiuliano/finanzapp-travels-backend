import { IsMongoId, IsString, Matches } from 'class-validator';

const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class ConfirmBillingPeriodDto {
  @IsMongoId({ message: 'paymentMethodId debe ser un ObjectId válido' })
  paymentMethodId: string;

  @IsString()
  @Matches(YEAR_MONTH_PATTERN, {
    message: 'cycleLabel debe tener formato YYYY-MM',
  })
  cycleLabel: string;

  @IsString()
  @Matches(DATE_PATTERN, {
    message: 'periodFrom debe tener formato YYYY-MM-DD',
  })
  periodFrom: string;

  @IsString()
  @Matches(DATE_PATTERN, {
    message: 'periodTo debe tener formato YYYY-MM-DD',
  })
  periodTo: string;
}
