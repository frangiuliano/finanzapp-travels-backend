import { IsBoolean } from 'class-validator';

export class UpdateBoardVisibilityDto {
  @IsBoolean()
  enabled: boolean;
}
