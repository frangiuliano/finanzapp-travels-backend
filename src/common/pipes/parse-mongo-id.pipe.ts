import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { Types } from 'mongoose';

const MONGO_ID_PARAM_NAMES = new Set([
  'id',
  'boardId',
  'tripId',
  'participantId',
  'invitationId',
  'paymentMethodId',
  'holdingId',
  'positionId',
  'transactionId',
]);

@Injectable()
export class ParseMongoIdPipe implements PipeTransform<string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (
      metadata.type !== 'param' ||
      !metadata.data ||
      !MONGO_ID_PARAM_NAMES.has(metadata.data)
    ) {
      return value;
    }

    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(
        `El parámetro ${metadata.data} debe ser un ObjectId válido`,
      );
    }

    return value;
  }
}
