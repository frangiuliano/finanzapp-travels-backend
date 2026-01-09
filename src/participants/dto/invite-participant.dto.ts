import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class InviteParticipantDto {
  @IsString()
  @IsNotEmpty({ message: 'El ID del viaje es requerido' })
  tripId: string;

  @IsEmail({}, { message: 'El email no es válido' })
  @IsNotEmpty({ message: 'El email es requerido' })
  email: string;
}
