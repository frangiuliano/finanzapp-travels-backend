import { IsMongoId, IsNotEmpty } from 'class-validator';

export class UploadStatementDto {
  @IsNotEmpty({ message: 'boardId es requerido' })
  @IsMongoId({ message: 'El ID del tablero no es válido' })
  boardId: string;

  @IsNotEmpty({ message: 'paymentMethodId es requerido' })
  @IsMongoId({ message: 'El ID del medio de pago no es válido' })
  paymentMethodId: string;
}
