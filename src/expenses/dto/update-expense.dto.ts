import {
  IsOptional,
  IsString,
  IsNumber,
  IsMongoId,
  IsEnum,
  IsArray,
  IsBoolean,
  ValidateNested,
  IsIn,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ExpenseStatus, SplitType } from '../expense.schema';
import { ExpenseSplitDto } from './expense-split.dto';
import { ThirdPartyPayerDto } from './third-party-payer.dto';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';

export class UpdateExpenseDto {
  @IsOptional()
  @IsMongoId({ message: 'El ID del viaje no es válido' })
  tripId?: string;

  @IsOptional()
  @IsMongoId({ message: 'El ID del presupuesto no es válido' })
  budgetId?: string;

  @IsOptional()
  @IsNumber({}, { message: 'El monto debe ser un número' })
  @Min(0.01, { message: 'El monto debe ser mayor a 0' })
  amount?: number;

  @IsOptional()
  @IsString({ message: 'La moneda debe ser texto' })
  @IsIn(SUPPORTED_CURRENCIES, {
    message: 'Moneda no válida',
  })
  currency?: string;

  @IsOptional()
  @IsString({ message: 'La descripción debe ser texto' })
  @MinLength(3, { message: 'La descripción debe tener al menos 3 caracteres' })
  @MaxLength(500, {
    message: 'La descripción no puede tener más de 500 caracteres',
  })
  description?: string;

  @IsOptional()
  @IsString({ message: 'El nombre del comercio debe ser texto' })
  @MaxLength(100, {
    message: 'El nombre del comercio no puede tener más de 100 caracteres',
  })
  merchantName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString({ message: 'La categoría debe ser texto' })
  @MaxLength(50, {
    message: 'La categoría no puede tener más de 50 caracteres',
  })
  category?: string;

  @IsOptional()
  @IsMongoId({ message: 'El ID del participante no es válido' })
  paidByParticipantId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ThirdPartyPayerDto)
  paidByThirdParty?: ThirdPartyPayerDto;

  @IsOptional()
  @IsEnum(ExpenseStatus, {
    message: 'El estado debe ser "paid" o "pending"',
  })
  status?: ExpenseStatus;

  @IsOptional()
  @IsBoolean()
  isDivisible?: boolean;

  @IsOptional()
  @IsEnum(SplitType, {
    message: 'El tipo de división debe ser "equal" o "manual"',
  })
  splitType?: SplitType;

  @IsOptional()
  @IsArray({ message: 'Las divisiones deben ser un array' })
  @ValidateNested({ each: true })
  @Type(() => ExpenseSplitDto)
  splits?: ExpenseSplitDto[];

  @IsOptional()
  @IsString()
  expenseDate?: string;
}
