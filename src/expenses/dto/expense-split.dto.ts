import {
  IsNotEmpty,
  IsNumber,
  IsMongoId,
  Min,
  Max,
  IsOptional,
} from 'class-validator';

export class ExpenseSplitDto {
  @IsNotEmpty({ message: 'El ID del participante es obligatorio' })
  @IsMongoId({ message: 'El ID del participante no es válido' })
  participantId: string;

  @IsNotEmpty({ message: 'El monto es obligatorio' })
  @IsNumber({}, { message: 'El monto debe ser un número' })
  @Min(0, { message: 'El monto no puede ser negativo' })
  amount: number;

  @IsOptional()
  @IsNumber({}, { message: 'El porcentaje debe ser un número' })
  @Min(0, { message: 'El porcentaje no puede ser negativo' })
  @Max(100, { message: 'El porcentaje no puede ser mayor a 100' })
  percentage?: number;
}
