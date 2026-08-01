import { IsMongoId, IsOptional, ValidateIf } from 'class-validator';

export class UpdateUserPreferencesDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsMongoId({ message: 'El ID del tablero activo no es válido' })
  activeBoardId?: string | null;
}
