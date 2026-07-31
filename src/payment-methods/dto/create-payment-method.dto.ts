import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  Matches,
  ValidateIf,
} from 'class-validator';
import {
  PaymentMethodKind,
  PaymentMethodOwnerType,
} from '../payment-method.schema';

export class CreatePaymentMethodDto {
  @IsEnum(PaymentMethodOwnerType, {
    message: 'ownerType debe ser user o board',
  })
  ownerType: PaymentMethodOwnerType;

  @IsEnum(PaymentMethodKind, {
    message: 'kind debe ser cash, debit o credit',
  })
  kind: PaymentMethodKind;

  @ValidateIf(
    (o: CreatePaymentMethodDto) =>
      o.ownerType === PaymentMethodOwnerType.BOARD && !o.tripId,
  )
  @IsNotEmpty({
    message: 'boardId o tripId es requerido para métodos del tablero',
  })
  @IsMongoId({ message: 'El ID del tablero no es válido' })
  boardId?: string;

  @ValidateIf(
    (o: CreatePaymentMethodDto) =>
      o.ownerType === PaymentMethodOwnerType.BOARD && !o.boardId,
  )
  @IsNotEmpty({
    message: 'boardId o tripId es requerido para métodos del tablero',
  })
  @IsMongoId({ message: 'El ID del tablero no es válido' })
  tripId?: string;

  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @IsString({ message: 'El nombre debe ser texto' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(100, {
    message: 'El nombre no puede tener más de 100 caracteres',
  })
  name: string;

  @ValidateIf(
    (o: CreatePaymentMethodDto) =>
      o.kind === PaymentMethodKind.DEBIT || o.kind === PaymentMethodKind.CREDIT,
  )
  @IsNotEmpty({
    message: 'Los últimos 4 dígitos son obligatorios para débito y crédito',
  })
  @IsString({ message: 'Los últimos 4 dígitos deben ser texto' })
  @MinLength(4, { message: 'Debe tener exactamente 4 dígitos' })
  @MaxLength(4, { message: 'Debe tener exactamente 4 dígitos' })
  @Matches(/^\d{4}$/, {
    message: 'Los últimos 4 dígitos deben ser números',
  })
  lastFourDigits?: string;

  @IsOptional()
  @IsString({ message: 'La marca debe ser texto' })
  @MaxLength(50, { message: 'La marca no puede tener más de 50 caracteres' })
  brand?: string;

  @IsOptional()
  @Min(1, { message: 'closingDay debe estar entre 1 y 28' })
  @Max(28, { message: 'closingDay debe estar entre 1 y 28' })
  closingDay?: number;

  @IsOptional()
  @Min(1, { message: 'dueDay debe estar entre 1 y 28' })
  @Max(28, { message: 'dueDay debe estar entre 1 y 28' })
  dueDay?: number;
}
