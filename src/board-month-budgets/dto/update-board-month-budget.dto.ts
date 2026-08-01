import { IsNumber, Min, IsOptional, IsString } from 'class-validator';

export class UpdateBoardMonthBudgetDto {
  @IsOptional()
  @IsNumber({}, { message: 'limit debe ser un número' })
  @Min(0, { message: 'limit no puede ser negativo' })
  limit?: number;

  @IsOptional()
  @IsString({ message: 'currency debe ser texto' })
  currency?: string;
}
