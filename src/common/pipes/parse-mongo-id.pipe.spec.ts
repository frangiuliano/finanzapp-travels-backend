import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ParseMongoIdPipe } from './parse-mongo-id.pipe';

describe('ParseMongoIdPipe', () => {
  const pipe = new ParseMongoIdPipe();

  function paramMetadata(data: string): ArgumentMetadata {
    return { type: 'param', data };
  }

  it.each([
    'id',
    'boardId',
    'tripId',
    'participantId',
    'invitationId',
    'paymentMethodId',
    'holdingId',
    'positionId',
    'transactionId',
  ])('accepts a valid ObjectId for %s', (paramName) => {
    const id = new Types.ObjectId().toString();

    expect(pipe.transform(id, paramMetadata(paramName))).toBe(id);
  });

  it('rejects malformed MongoDB IDs with BadRequestException', () => {
    expect(() => pipe.transform('no-es-un-id', paramMetadata('id'))).toThrow(
      BadRequestException,
    );
  });

  it.each(['token', 'source'])('does not validate non-ID param %s', (name) => {
    expect(pipe.transform('arbitrary-value', paramMetadata(name))).toBe(
      'arbitrary-value',
    );
  });

  it('does not validate body values', () => {
    expect(pipe.transform('no-es-un-id', { type: 'body', data: 'id' })).toBe(
      'no-es-un-id',
    );
  });
});
