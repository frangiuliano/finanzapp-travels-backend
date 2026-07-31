import {
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsMongoId,
  ValidateIf,
} from 'class-validator';

export class CreateCategoryDto {
  @ValidateIf((o: CreateCategoryDto) => !o.tripId)
  @IsNotEmpty({ message: 'boardId o tripId es requerido' })
  @IsMongoId({ message: 'El ID del tablero no es válido' })
  boardId?: string;

  @ValidateIf((o: CreateCategoryDto) => !o.boardId)
  @IsNotEmpty({ message: 'boardId o tripId es requerido' })
  @IsMongoId({ message: 'El ID del tablero no es válido' })
  tripId?: string;

  @IsNotEmpty({ message: 'El nombre de la categoría es obligatorio' })
  @IsString({ message: 'El nombre debe ser texto' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(100, {
    message: 'El nombre no puede tener más de 100 caracteres',
  })
  name: string;

  @IsOptional()
  @IsString({ message: 'El icono debe ser texto' })
  @MaxLength(50, { message: 'El icono no puede tener más de 50 caracteres' })
  icon?: string;

  @IsOptional()
  @IsString({ message: 'El color debe ser texto' })
  @MaxLength(20, { message: 'El color no puede tener más de 20 caracteres' })
  color?: string;
}
