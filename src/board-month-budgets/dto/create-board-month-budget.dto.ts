import {
  IsNotEmpty,
  IsString,
  IsNumber,
  Min,
  IsOptional,
  IsMongoId,
  ValidateIf,
  Matches,
} from 'class-validator';

const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class CreateBoardMonthBudgetDto {
  @ValidateIf((o: CreateBoardMonthBudgetDto) => !o.tripId)
  @IsNotEmpty({ message: 'boardId o tripId es requerido' })
  @IsMongoId({ message: 'El ID del tablero no es válido' })
  boardId?: string;

  @ValidateIf((o: CreateBoardMonthBudgetDto) => !o.boardId)
  @IsNotEmpty({ message: 'boardId o tripId es requerido' })
  @IsMongoId({ message: 'El ID del tablero no es válido' })
  tripId?: string;

  @IsNotEmpty({ message: 'categoryId es requerido' })
  @IsMongoId({ message: 'El ID de la categoría no es válido' })
  categoryId: string;

  @IsNotEmpty({ message: 'yearMonth es requerido' })
  @IsString({ message: 'yearMonth debe ser texto' })
  @Matches(YEAR_MONTH_PATTERN, {
    message: 'yearMonth debe tener formato YYYY-MM (ej. 2026-07)',
  })
  yearMonth: string;

  @IsNumber({}, { message: 'limit debe ser un número' })
  @Min(0, { message: 'limit no puede ser negativo' })
  limit: number;

  @IsOptional()
  @IsString({ message: 'currency debe ser texto' })
  currency?: string;
}
