import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
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
  ValidateNested,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../common/constants/currencies';
import { GoalStatus } from './goals.schemas';

export class GoalHoldingSelectionInputDto {
  @IsMongoId() holdingId: string;
  @IsOptional() @IsBoolean() useEstimatedFx?: boolean;
}

export class CreateGoalDto {
  @IsString() @MinLength(2) @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(10) icon?: string;
  @IsNumber() @Min(0.01) targetAmount: number;
  @IsIn(SUPPORTED_CURRENCIES) currency: string;
  @IsOptional() @IsDateString() targetDate?: string;
  @IsOptional() @IsNumber() @Min(0.01) desiredMonthlyContribution?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10) priority?: number;
  @IsOptional() @IsBoolean() useEstimatedFxForForecast?: boolean;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoalHoldingSelectionInputDto)
  holdingSelections?: GoalHoldingSelectionInputDto[];
}

export class UpdateGoalDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(10) icon?: string;
  @IsOptional() @IsNumber() @Min(0.01) targetAmount?: number;
  @IsOptional() @IsDateString() targetDate?: string;
  @IsOptional() @IsNumber() @Min(0.01) desiredMonthlyContribution?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10) priority?: number;
  @IsOptional() @IsEnum(GoalStatus) status?: GoalStatus;
  @IsOptional() @IsBoolean() useEstimatedFxForForecast?: boolean;
}

export class UpdateGoalHoldingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoalHoldingSelectionInputDto)
  holdingSelections: GoalHoldingSelectionInputDto[];
}

export class PreviewGoalDto {
  @IsOptional() @IsMongoId() goalId?: string;
  @IsString() @MinLength(2) @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(10) icon?: string;
  @IsNumber() @Min(0.01) targetAmount: number;
  @IsIn(SUPPORTED_CURRENCIES) currency: string;
  @IsOptional() @IsDateString() targetDate?: string;
  @IsOptional() @IsNumber() @Min(0.01) desiredMonthlyContribution?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10) priority?: number;
  @IsOptional() @IsEnum(GoalStatus) status?: GoalStatus;
  @IsOptional() @IsBoolean() useEstimatedFxForForecast?: boolean;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoalHoldingSelectionInputDto)
  holdingSelections: GoalHoldingSelectionInputDto[];
}
