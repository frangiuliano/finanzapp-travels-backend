import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { PAYMENT_METHOD_INSTITUTION_CODES } from '../constants/payment-method-institutions';

export class UpdatePaymentMethodDto {
  @IsOptional()
  @IsString({ message: 'El nombre debe ser texto' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(100, {
    message: 'El nombre no puede tener más de 100 caracteres',
  })
  name?: string;

  @IsOptional()
  @IsString({ message: 'La institución debe ser texto' })
  @MaxLength(80, {
    message: 'La institución no puede tener más de 80 caracteres',
  })
  institution?: string;

  @IsOptional()
  @IsString({ message: 'El código de institución debe ser texto' })
  @IsIn(PAYMENT_METHOD_INSTITUTION_CODES, {
    message: 'La institución seleccionada no es válida',
  })
  institutionCode?: string | null;

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
  @IsBoolean({ message: 'isActive debe ser booleano' })
  isActive?: boolean;
}
