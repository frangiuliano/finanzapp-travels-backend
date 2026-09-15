import {
  IsISO8601,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsIn } from 'class-validator';
import { Transform } from 'class-transformer';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';

export class CreateShortcutExpenseDto {
  @IsMongoId()
  boardId: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MinLength(1)
  @MaxLength(100)
  merchantName: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsMongoId()
  categoryId: string;

  @IsMongoId()
  paymentMethodId: string;

  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;

  @IsOptional()
  @IsMongoId()
  budgetId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  expenseDate?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'paymentYearMonth debe tener formato YYYY-MM',
  })
  paymentYearMonth?: string;

  @IsUUID('4')
  clientRequestId: string;
}
