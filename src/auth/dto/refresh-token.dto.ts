import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @IsNotEmpty({ message: 'El refresh token es obligatorio' })
  @IsString()
  refreshToken: string;
}
