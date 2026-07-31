import {
  IsBoolean,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  Matches,
} from 'class-validator';

export class UpdatePaymentMethodDto {
  @IsOptional()
  @IsString({ message: 'El nombre debe ser texto' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(100, {
    message: 'El nombre no puede tener más de 100 caracteres',
  })
  name?: string;

  @IsOptional()
  @IsString({ message: 'Los últimos 4 dígitos deben ser texto' })
  @MinLength(4, { message: 'Debe tener exactamente 4 dígitos' })
  @MaxLength(4, { message: 'Debe tener exactamente 4 dígitos' })
  @Matches(/^\d{4}$/, {
    message: 'Los últimos 4 dígitos deben ser números',
  })
  lastFourDigits?: string;

  @IsOptional()
  @IsString({ message: 'La marca debe ser texto' })
  @MaxLength(50, { message: 'La marca no puede tener más de 50 caracteres' })
  brand?: string;

  @IsOptional()
  @Min(1, { message: 'closingDay debe estar entre 1 y 28' })
  @Max(28, { message: 'closingDay debe estar entre 1 y 28' })
  closingDay?: number;

  @IsOptional()
  @Min(1, { message: 'dueDay debe estar entre 1 y 28' })
  @Max(28, { message: 'dueDay debe estar entre 1 y 28' })
  dueDay?: number;

  @IsOptional()
  @IsBoolean({ message: 'isActive debe ser booleano' })
  isActive?: boolean;
}
