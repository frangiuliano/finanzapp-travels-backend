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
}
