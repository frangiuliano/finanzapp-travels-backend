import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsMongoId,
  IsOptional,
  IsIn,
  Min,
  MinLength,
  MaxLength,
  ValidateIf,
  IsInt,
  Max,
  Matches,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';

export class CreateInstallmentPlanDto {
  @ValidateIf((o: CreateInstallmentPlanDto) => !o.tripId)
  @IsNotEmpty({ message: 'boardId o tripId es requerido' })
  @IsMongoId()
  boardId?: string;

  @ValidateIf((o: CreateInstallmentPlanDto) => !o.boardId)
  @IsNotEmpty({ message: 'boardId o tripId es requerido' })
  @IsMongoId()
  tripId?: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.01)
  installmentAmount: number;

  @IsInt()
  @Min(1)
  @Max(120)
  totalInstallments: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  paidInstallments?: number;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'startYearMonth debe tener formato YYYY-MM',
  })
  startYearMonth: string;

  @IsInt()
  @Min(1)
  dayOfMonth: number;

  @IsOptional()
  @IsMongoId()
  paymentMethodId?: string;

  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  fxRateOverride?: number;
}
