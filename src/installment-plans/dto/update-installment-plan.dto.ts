import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  Min,
  MinLength,
  MaxLength,
  IsInt,
  Max,
  IsBoolean,
  IsMongoId,
  Matches,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';

export class UpdateInstallmentPlanDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  installmentAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  totalInstallments?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  paidInstallments?: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  startYearMonth?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  dayOfMonth?: number;

  @IsOptional()
  @IsMongoId()
  paymentMethodId?: string;

  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
