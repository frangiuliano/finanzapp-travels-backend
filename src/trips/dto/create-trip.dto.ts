import {
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsIn,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';

export class CreateTripDto {
  @IsNotEmpty({ message: 'El nombre del viaje es obligatorio' })
  @IsString({ message: 'El nombre debe ser texto' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(100, {
    message: 'El nombre no puede tener más de 100 caracteres',
  })
  name: string;

  @IsOptional()
  @IsString({ message: 'La moneda debe ser texto' })
  @IsIn(SUPPORTED_CURRENCIES, {
    message: 'Moneda no válida',
  })
  baseCurrency?: string;
}
