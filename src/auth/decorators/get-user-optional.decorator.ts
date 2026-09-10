import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { UserDocument } from '../../users/user.schema';

export const GetUserOptional = createParamDecorator(
  (data: keyof UserDocument | undefined, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: UserDocument }>();

    if (!request.user) {
      return undefined;
    }

    if (data) {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- returns a field value by key, never invoked as a method
      return request.user[data];
    }

    return request.user;
  },
);
