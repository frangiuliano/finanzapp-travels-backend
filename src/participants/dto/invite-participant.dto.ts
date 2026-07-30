import {
  IsEmail,
  IsMongoId,
  IsNotEmpty,
  IsString,
  ValidateIf,
} from 'class-validator';

export class InviteParticipantDto {
  @ValidateIf((o: InviteParticipantDto) => !o.tripId)
  @IsNotEmpty({ message: 'boardId o tripId es requerido' })
  @IsMongoId({ message: 'El ID del tablero no es válido' })
  boardId?: string;

  @ValidateIf((o: InviteParticipantDto) => !o.boardId)
  @IsNotEmpty({ message: 'boardId o tripId es requerido' })
  @IsMongoId({ message: 'El ID del tablero no es válido' })
  tripId?: string;

  @IsEmail({}, { message: 'El email no es válido' })
  @IsNotEmpty({ message: 'El email es requerido' })
  @IsString()
  email: string;
}
