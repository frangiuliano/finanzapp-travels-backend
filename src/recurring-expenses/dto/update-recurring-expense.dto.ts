import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  Min,
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
}
