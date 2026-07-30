import {
  IsNotEmpty,
  IsString,
  IsNumber,
  MinLength,
  MaxLength,
  Min,
  IsOptional,
  IsIn,
  IsMongoId,
  ValidateIf,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';

export class CreateBudgetDto {
  @ValidateIf((o: CreateBudgetDto) => !o.tripId)
  @IsNotEmpty({ message: 'boardId o tripId es requerido' })
  @IsMongoId({ message: 'El ID del tablero no es válido' })
  boardId?: string;

  @ValidateIf((o: CreateBudgetDto) => !o.boardId)
  @IsNotEmpty({ message: 'boardId o tripId es requerido' })
  @IsMongoId({ message: 'El ID del tablero no es válido' })
  tripId?: string;

  @IsNotEmpty({ message: 'El nombre del presupuesto es obligatorio' })
  @IsString({ message: 'El nombre debe ser texto' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(100, {
    message: 'El nombre no puede tener más de 100 caracteres',
  })
  name: string;

  @IsNotEmpty({ message: 'El monto es obligatorio' })
  @IsNumber({}, { message: 'El monto debe ser un número' })
  @Min(0, { message: 'El monto no puede ser negativo' })
  amount: number;

  @IsOptional()
  @IsString({ message: 'La moneda debe ser texto' })
  @IsIn(SUPPORTED_CURRENCIES, {
    message: 'Moneda no válida',
  })
  currency?: string;
}
