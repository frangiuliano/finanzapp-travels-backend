import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsMongoId,
  IsOptional,
  IsIn,
  Min,
  MinLength,
  MaxLength,
  ValidateIf,
  IsArray,
  ArrayMinSize,
  IsInt,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';

export class CreateRecurringIncomeDto {
  @ValidateIf((o: CreateRecurringIncomeDto) => !o.tripId)
  @IsNotEmpty({ message: 'boardId o tripId es requerido' })
  @IsMongoId({ message: 'El ID del tablero no es válido' })
  boardId?: string;

  @ValidateIf((o: CreateRecurringIncomeDto) => !o.boardId)
  @IsNotEmpty({ message: 'boardId o tripId es requerido' })
  @IsMongoId({ message: 'El ID del tablero no es válido' })
  tripId?: string;

  @IsNotEmpty({ message: 'El monto es obligatorio' })
  @IsNumber({}, { message: 'El monto debe ser un número' })
  @Min(0.01, { message: 'El monto debe ser mayor a 0' })
  amount: number;

  @IsOptional()
  @IsString({ message: 'La moneda debe ser texto' })
  @IsIn(SUPPORTED_CURRENCIES, { message: 'Moneda no válida' })
  currency?: string;

  @IsNotEmpty({ message: 'La etiqueta es obligatoria' })
  @IsString({ message: 'La etiqueta debe ser texto' })
  @MinLength(1)
  @MaxLength(200)
  label: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsArray({ message: 'daysOfMonth debe ser un arreglo' })
  @ArrayMinSize(1, { message: 'Seleccioná al menos un día del mes' })
  @IsInt({ each: true, message: 'Cada día debe ser un entero' })
  daysOfMonth: number[];
}
