import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  IsEnum,
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

export enum InstallmentOverridePolicy {
  PRESERVE = 'preserve',
  REPLACE = 'replace',
}

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
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  startYearMonth?: string;

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

  /** Purely informational — which day of the month each cuota displays. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number;

  /**
   * Required confirmation once the server reports `needs_decision` with a
   * `customOverrides` block. Decides whether individually-customized
   * pending cuotas keep their own amount/description or get replaced by
   * the plan's new values.
   */
  @IsOptional()
  @IsEnum(InstallmentOverridePolicy)
  overridePolicy?: InstallmentOverridePolicy;
}
