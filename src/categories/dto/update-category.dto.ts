import {
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
  IsBoolean,
} from 'class-validator';

export class UpdateCategoryDto {
  @IsOptional()
  @IsString({ message: 'El nombre debe ser texto' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(100, {
    message: 'El nombre no puede tener más de 100 caracteres',
  })
  name?: string;

  @IsOptional()
  @IsString({ message: 'El icono debe ser texto' })
  @MaxLength(50, { message: 'El icono no puede tener más de 50 caracteres' })
  icon?: string;

  @IsOptional()
  @IsString({ message: 'El color debe ser texto' })
  @MaxLength(20, { message: 'El color no puede tener más de 20 caracteres' })
  color?: string;

  @IsOptional()
  @IsBoolean({ message: 'isActive debe ser booleano' })
  isActive?: boolean;
}
