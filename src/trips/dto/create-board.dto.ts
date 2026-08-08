import {
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsIn,
  IsEnum,
  IsMongoId,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';
import { BoardType } from '../board.schema';

export class CreateBoardDto {
  @IsNotEmpty({ message: 'El nombre del tablero es obligatorio' })
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

  @IsOptional()
  @IsEnum(BoardType, {
    message: 'El tipo debe ser "everyday" o "travel"',
  })
  type?: BoardType;

  @IsOptional()
  @IsMongoId({ message: 'El tablero principal no es válido' })
  parentBoardId?: string;
}

/** @deprecated Use CreateBoardDto */
export { CreateBoardDto as CreateTripDto };
