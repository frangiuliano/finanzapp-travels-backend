import {
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class SimulateExpenseDto {
  @ValidateIf((dto: SimulateExpenseDto) => !dto.tripId)
  @IsNotEmpty({ message: 'boardId o tripId es requerido' })
  @IsMongoId()
  boardId?: string;

  @ValidateIf((dto: SimulateExpenseDto) => !dto.boardId)
  @IsNotEmpty({ message: 'boardId o tripId es requerido' })
  @IsMongoId()
  tripId?: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.01)
  totalAmount: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(48)
  installments?: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'startYearMonth debe tener formato YYYY-MM',
  })
  startYearMonth?: string;
}
