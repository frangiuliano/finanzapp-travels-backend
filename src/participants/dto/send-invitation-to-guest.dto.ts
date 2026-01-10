import { IsNotEmpty, IsEmail, MaxLength } from 'class-validator';

export class SendInvitationToGuestDto {
  @IsNotEmpty({ message: 'El email es obligatorio' })
  @IsEmail({}, { message: 'El email no es válido' })
  @MaxLength(255, { message: 'El email no puede tener más de 255 caracteres' })
  email: string;
}
