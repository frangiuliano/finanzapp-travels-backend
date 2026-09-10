import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  Min,
  MinLength,
  MaxLength,
  IsArray,
  ArrayMinSize,
  IsInt,
  IsBoolean,
  Matches,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';

export class UpdateRecurringIncomeDto {
  @IsOptional()
  @IsNumber({}, { message: 'El monto debe ser un número' })
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  daysOfMonth?: number[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** When changing amount: apply only to amountChangeYearMonth or from that month */
  @IsOptional()
  @IsIn(['this_month', 'from_month'])
  amountChangeScope?: 'this_month' | 'from_month';

  @IsOptional()
  @IsString()
  amountChangeYearMonth?: string;

  /** Stop generating occurrences from this month (YYYY-MM) */
  @IsOptional()
  @IsString()
  cancelFromYearMonth?: string;

  /** Months (YYYY-MM) unticked from the 12-month recurring checklist. */
  @IsOptional()
  @IsArray()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { each: true })
  excludedYearMonths?: string[];
}
