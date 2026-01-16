import {
  IsOptional,
  IsString,
  IsMongoId,
  IsEnum,
  IsBoolean,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { CardType } from '../card.schema';

export class UpdateCardDto {
  @IsOptional()
  @IsMongoId({ message: 'El ID del viaje no es válido' })
  tripId?: string;

  @IsOptional()
  @IsString({ message: 'El nombre debe ser texto' })
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
  @IsEnum(CardType, {
    message: 'El tipo de tarjeta no es válido',
  })
  type?: CardType;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
