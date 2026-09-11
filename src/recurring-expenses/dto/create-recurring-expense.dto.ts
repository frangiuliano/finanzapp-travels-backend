import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsMongoId,
  IsOptional,
  IsIn,
  Min,
  Max,
  MinLength,
  MaxLength,
  ValidateIf,
  IsInt,
  IsArray,
  Matches,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';

export class CreateRecurringExpenseDto {
  @ValidateIf((o: CreateRecurringExpenseDto) => !o.tripId)
  @IsNotEmpty({ message: 'boardId o tripId es requerido' })
  @IsMongoId()
  boardId?: string;

  @ValidateIf((o: CreateRecurringExpenseDto) => !o.boardId)
  @IsNotEmpty({ message: 'boardId o tripId es requerido' })
  @IsMongoId()
  tripId?: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsInt({ message: 'dayOfMonth debe ser un entero' })
  @Min(1)
  dayOfMonth: number;

  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @IsOptional()
  @IsMongoId()
  paymentMethodId?: string;

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

  /** Months (YYYY-MM) unticked from the 12-month recurring checklist. */
  @IsOptional()
  @IsArray()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { each: true })
  excludedYearMonths?: string[];

  /**
   * Month (YYYY-MM) the escalation cycle counts from — i.e. when the amount
   * above became/becomes effective. Defaults to the current month, but can be
   * set to a past or future month so the first increase lands on the right
   * date instead of always being `escalationFrequencyMonths` after creation.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'anchorYearMonth debe tener formato YYYY-MM',
  })
  anchorYearMonth?: string;
}
