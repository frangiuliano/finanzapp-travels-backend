import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  Min,
  Max,
  MinLength,
  MaxLength,
  IsInt,
  IsBoolean,
  IsMongoId,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';

export class UpdateRecurringExpenseDto {
  @IsOptional()
  @IsNumber()
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
  @IsInt()
  @Min(1)
  dayOfMonth?: number;

  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @IsOptional()
  @IsMongoId()
  paymentMethodId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsIn(['this_month', 'from_month'])
  amountChangeScope?: 'this_month' | 'from_month';

  @IsOptional()
  @IsString()
  amountChangeYearMonth?: string;

  @IsOptional()
  @IsString()
  cancelFromYearMonth?: string;

  @IsOptional()
  @IsIn(['percent', 'fixed'], {
    message: 'escalationType debe ser "percent" o "fixed"',
  })
  escalationType?: 'percent' | 'fixed';

  @IsOptional()
  @IsNumber()
  @Min(0.01, { message: 'escalationValue debe ser mayor a 0' })
  escalationValue?: number;

  @IsOptional()
  @IsInt({ message: 'escalationFrequencyMonths debe ser un entero' })
  @Min(1, { message: 'escalationFrequencyMonths debe ser al menos 1' })
  @Max(60, { message: 'escalationFrequencyMonths debe ser como máximo 60' })
  escalationFrequencyMonths?: number;

  /** When true, removes any escalation config from this recurring expense. */
  @IsOptional()
  @IsBoolean()
  disableEscalation?: boolean;
}
