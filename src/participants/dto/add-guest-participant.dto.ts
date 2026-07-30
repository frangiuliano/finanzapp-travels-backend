import {
  IsNotEmpty,
  IsString,
  IsMongoId,
  IsEmail,
  IsOptional,
  MinLength,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class AddGuestParticipantDto {
  @ValidateIf((o: AddGuestParticipantDto) => !o.tripId)
  @IsNotEmpty({ message: 'boardId o tripId es requerido' })
  @IsMongoId({ message: 'El ID del tablero no es válido' })
  boardId?: string;

  @ValidateIf((o: AddGuestParticipantDto) => !o.boardId)
  @IsNotEmpty({ message: 'boardId o tripId es requerido' })
  @IsMongoId({ message: 'El ID del tablero no es válido' })
  tripId?: string;

  @IsNotEmpty({ message: 'El nombre del invitado es obligatorio' })
  @IsString({ message: 'El nombre debe ser texto' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(100, {
    message: 'El nombre no puede tener más de 100 caracteres',
  })
  guestName: string;

  @IsOptional()
  @IsEmail({}, { message: 'El email no es válido' })
  guestEmail?: string;
}
