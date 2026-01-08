import {
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsIn,
} from 'class-validator';

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
  @IsIn(['USD', 'EUR', 'ARS', 'BRL', 'MXN', 'COP', 'CLP', 'PEN'], {
    message: 'Moneda no válida',
  })
  baseCurrency?: string;
}
