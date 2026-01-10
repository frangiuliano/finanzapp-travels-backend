import {
  IsOptional,
  IsString,
  IsNumber,
  MinLength,
  MaxLength,
  Min,
  IsIn,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';

export class UpdateBudgetDto {
  @IsOptional()
  @IsString({ message: 'El nombre debe ser texto' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(100, {
    message: 'El nombre no puede tener más de 100 caracteres',
  })
  name?: string;

  @IsOptional()
  @IsNumber({}, { message: 'El monto debe ser un número' })
  @Min(0, { message: 'El monto no puede ser negativo' })
  amount?: number;

  @IsOptional()
  @IsString({ message: 'La moneda debe ser texto' })
  @IsIn(SUPPORTED_CURRENCIES, {
    message: 'Moneda no válida',
  })
  currency?: string;
}
