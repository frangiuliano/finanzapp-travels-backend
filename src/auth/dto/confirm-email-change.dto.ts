import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ConfirmEmailChangeDto {
  @IsString()
  @IsNotEmpty({ message: 'El token es obligatorio' })
  @MaxLength(128)
  token: string;
}
