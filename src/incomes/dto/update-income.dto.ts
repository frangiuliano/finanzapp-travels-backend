import {
  IsOptional,
  IsString,
  IsNumber,
  IsIn,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';

export class UpdateIncomeDto {
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
  @IsString({ message: 'La etiqueta debe ser texto' })
  @MinLength(1, { message: 'La etiqueta debe tener al menos 1 carácter' })
  @MaxLength(200, {
    message: 'La etiqueta no puede tener más de 200 caracteres',
  })
  label?: string;

  @IsOptional()
  @IsString({ message: 'La descripción debe ser texto' })
  @MaxLength(500, {
    message: 'La descripción no puede tener más de 500 caracteres',
  })
  description?: string;

  @IsOptional()
  @IsString()
  incomeDate?: string;
}
