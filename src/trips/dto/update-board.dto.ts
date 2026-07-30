import {
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
  IsIn,
  IsEnum,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';
import { BoardType } from '../board.schema';

export class UpdateBoardDto {
  @IsOptional()
  @IsString({ message: 'El nombre debe ser texto' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(100, {
    message: 'El nombre no puede tener más de 100 caracteres',
  })
  name?: string;

  @IsOptional()
  @IsString({ message: 'La moneda debe ser texto' })
  @IsIn(SUPPORTED_CURRENCIES, {
    message: 'Moneda no válida',
  })
  baseCurrency?: string;

  @IsOptional()
  @IsEnum(BoardType, {
    message: 'El tipo debe ser "everyday" o "travel"',
  })
  type?: BoardType;
}

/** @deprecated Use UpdateBoardDto */
export { UpdateBoardDto as UpdateTripDto };
