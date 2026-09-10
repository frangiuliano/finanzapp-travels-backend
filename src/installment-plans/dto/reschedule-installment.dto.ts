import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export enum InstallmentRescheduleScope {
  THIS = 'this',
  THIS_AND_FUTURE = 'this_and_future',
  ALL = 'all',
}

export class RescheduleInstallmentDto {
  /**
   * Anchor cuota. Required for scope "this" and for a month shift
   * (`targetYearMonth`). Optional for a plain "this_and_future" day sync
   * — when omitted there, the server resolves it from the first currently
   * pending (non-paid, non-skipped) installment instead of trusting a
   * client-side guess, since paidInstallments on the plan is a one-time
   * seed value that goes stale as cuotas get paid automatically over time.
   * Ignored for scope "all".
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  installmentNumber?: number;

  /**
   * Required unless `targetYearMonth` is provided — in that case the day is
   * always derived server-side (card closing day, or the plan's own day for
   * cash) and this is ignored.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number;

  /**
   * Moves the anchor cuota to this calendar month instead of syncing the
   * day. Scope "this" moves only the anchor; "this_and_future" cascades the
   * same month delta to every later, still-pending cuota, preserving their
   * relative spacing. Not applicable to scope "all".
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  targetYearMonth?: string;

  @IsEnum(InstallmentRescheduleScope)
  scope: InstallmentRescheduleScope;
}
