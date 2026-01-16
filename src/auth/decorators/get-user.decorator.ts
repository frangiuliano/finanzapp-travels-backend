import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { UserDocument } from '../../users/user.schema';

export const GetUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext): UserDocument | string => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: UserDocument }>();

    if (!request.user) {
      throw new UnauthorizedException('Usuario no encontrado en el request');
    }

    if (data === '_id') {
      return request.user._id.toString();
    }

    return request.user;
  },
);
