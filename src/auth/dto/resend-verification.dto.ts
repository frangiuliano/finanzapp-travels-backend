import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

export class ResendVerificationDto {
  @IsNotEmpty({ message: 'El email es obligatorio' })
  @IsEmail({}, { message: 'El email debe tener un formato válido' })
  @MaxLength(254, { message: 'El email es demasiado largo' })
  email: string;
}
