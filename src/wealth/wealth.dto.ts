import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../common/constants/currencies';
import {
  HoldingType,
  InstrumentType,
  InvestmentTransactionType,
  SavingsGoalStatus,
  WealthEventKind,
} from './wealth.schemas';

export class CreateHoldingDto {
  @IsString() @MinLength(2) @MaxLength(100) name: string;
  @IsEnum(HoldingType) type: HoldingType;
  @IsOptional() @IsString() @MaxLength(100) institution?: string;
  @IsIn(SUPPORTED_CURRENCIES) currency: string;
  @IsNumber() @Min(0) currentBalance: number;
}

export class UpdateHoldingDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) name?: string;
  @IsOptional() @IsEnum(HoldingType) type?: HoldingType;
  @IsOptional() @IsString() @MaxLength(100) institution?: string;
}

export class AdjustHoldingBalanceDto {
  @IsNumber() @Min(0) balance: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  @IsOptional() @IsDateString() occurredAt?: string;
}

export class CreateSavingsGoalDto {
  @IsString() @MinLength(2) @MaxLength(100) name: string;
  @IsNumber() @Min(0.01) targetAmount: number;
  @IsIn(SUPPORTED_CURRENCIES) currency: string;
  @IsOptional() @IsDateString() targetDate?: string;
  @IsOptional() @IsNumber() @Min(0.01) plannedMonthlyContribution?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10) priority?: number;
  @IsOptional() @IsString() @MaxLength(10) icon?: string;
}

export class UpdateSavingsGoalDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) name?: string;
  @IsOptional() @IsNumber() @Min(0.01) targetAmount?: number;
  @IsOptional() @IsDateString() targetDate?: string;
  @IsOptional() @IsNumber() @Min(0.01) plannedMonthlyContribution?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10) priority?: number;
  @IsOptional() @IsString() @MaxLength(10) icon?: string;
  @IsOptional() @IsEnum(SavingsGoalStatus) status?: SavingsGoalStatus;
}

export class CreateGoalContributionDto {
  @IsMongoId() holdingId: string;
  @IsIn([WealthEventKind.CONTRIBUTION, WealthEventKind.WITHDRAWAL]) kind:
    | WealthEventKind.CONTRIBUTION
    | WealthEventKind.WITHDRAWAL;
  @IsNumber() @Min(0.01) amount: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  @IsOptional() @IsDateString() occurredAt?: string;
}

export class CreateInstrumentDto {
  @IsString() @MinLength(1) @MaxLength(30) symbol: string;
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsEnum(InstrumentType) type: InstrumentType;
  @IsIn(SUPPORTED_CURRENCIES) currency: string;
  @IsOptional() @IsString() @MaxLength(50) exchange?: string;
}

export class CreatePositionDto {
  @IsMongoId() instrumentId: string;
  @IsNumber() @Min(0.00000001) quantity: number;
  @IsNumber() @Min(0) averageCost: number;
  @IsNumber() @Min(0) currentPrice: number;
}

export class UpdatePositionPriceDto {
  @IsNumber() @Min(0) currentPrice: number;
}

export class CreateInvestmentTransactionDto {
  @IsMongoId() instrumentId: string;
  @IsEnum(InvestmentTransactionType) type: InvestmentTransactionType;
  @IsNumber() @Min(0.00000001) quantity: number;
  @IsNumber() @Min(0) unitPrice: number;
  @IsOptional() @IsNumber() @Min(0) fees?: number;
  @IsOptional() @IsDateString() occurredAt?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}
