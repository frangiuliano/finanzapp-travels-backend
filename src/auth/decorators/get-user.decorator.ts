import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { UserDocument } from '../../users/user.schema';

export const GetUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): UserDocument => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: UserDocument }>();

    if (!request.user) {
      throw new UnauthorizedException('Usuario no encontrado en el request');
    }

    return request.user;
  },
);
