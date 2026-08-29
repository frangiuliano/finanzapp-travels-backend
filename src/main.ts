import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ConfigService } from '@nestjs/config';
import { ParseMongoIdPipe } from './common/pipes/parse-mongo-id.pipe';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.use(helmet());

  app.useGlobalPipes(
    new ParseMongoIdPipe(),
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const frontendUrl = configService.get<string>('FRONTEND_URL');
  const defaultOrigins = ['http://localhost:5173', 'http://localhost:3000'];
  const allowedOrigins = frontendUrl
    ? [...defaultOrigins, frontendUrl]
    : defaultOrigins;

  console.log('Orígenes permitidos por CORS:', allowedOrigins);

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Health probes (Fly.io), curl, and server-to-server calls omit Origin.
      if (!origin) {
        return callback(null, true);
      }

      const normalizedOrigin = (
        origin.endsWith('/') ? origin.slice(0, -1) : origin
      ).toLowerCase();

      const isAllowed = allowedOrigins.some((allowed) => {
        const normalizedAllowed = (
          allowed.endsWith('/') ? allowed.slice(0, -1) : allowed
        ).toLowerCase();
        return normalizedAllowed === normalizedOrigin;
      });

      if (isAllowed) {
        callback(null, true);
      } else {
        console.warn(`Origen no permitido por CORS: ${origin}`);
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      // Offline expense queue sends this on POST /expenses; omitting it
      // makes the browser abort the preflight as a "network error".
      'Idempotency-Key',
    ],
  });

  app.setGlobalPrefix('api');
  app.use(cookieParser());

  await app.listen(configService.get<number>('PORT', 8080));
}
void bootstrap();
