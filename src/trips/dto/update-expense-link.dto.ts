import { IsMongoId, IsOptional } from 'class-validator';

export class UpdateExpenseLinkDto {
  @IsOptional()
  @IsMongoId({ message: 'El tablero cotidiano no es válido' })
  everydayBoardId?: string | null;
}
