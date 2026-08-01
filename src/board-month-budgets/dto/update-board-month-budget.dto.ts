import { IsNumber, Min, IsOptional } from 'class-validator';

export class UpdateBoardMonthBudgetDto {
  @IsOptional()
  @IsNumber({}, { message: 'limit debe ser un número' })
  @Min(0, { message: 'limit no puede ser negativo' })
  limit?: number;
}
