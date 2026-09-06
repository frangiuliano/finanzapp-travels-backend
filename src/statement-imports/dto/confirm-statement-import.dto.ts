import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class StatementImportLineOverrideDto {
  @IsOptional()
  @IsNumber({}, { message: 'El monto debe ser un número' })
  @Min(0.01, { message: 'El monto debe ser mayor a 0' })
  amount?: number;

  @IsOptional()
  @IsString({ message: 'La descripción debe ser texto' })
  @MinLength(3, { message: 'La descripción debe tener al menos 3 caracteres' })
  @MaxLength(500, {
    message: 'La descripción no puede tener más de 500 caracteres',
  })
  description?: string;

  @IsOptional()
  @IsMongoId({ message: 'El ID de la categoría no es válido' })
  categoryId?: string;

  @IsOptional()
  @IsString()
  expenseDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  merchantName?: string;
}

export class StatementImportSelectionDto {
  @IsNotEmpty({ message: 'tempId es requerido' })
  @IsString()
  tempId: string;

  @IsBoolean()
  include: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => StatementImportLineOverrideDto)
  overrides?: StatementImportLineOverrideDto;
}

export class ConfirmStatementImportDto {
  @IsArray({ message: 'selections debe ser un array' })
  @ValidateNested({ each: true })
  @Type(() => StatementImportSelectionDto)
  selections: StatementImportSelectionDto[];
}
