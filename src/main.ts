import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Configurar Helmet para headers de seguridad
  app.use(helmet());

  // Configurar ValidationPipe más estricto
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Elimina propiedades no definidas en el DTO
      forbidNonWhitelisted: true, // Rechaza requests con propiedades extra
      transform: true, // Transforma los tipos automáticamente
      transformOptions: {
        enableImplicitConversion: true, // Convierte tipos implícitamente (ej: string a number)
      },
    }),
  );

  const frontendUrl = process.env.FRONTEND_URL;
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
        console.warn(`Orígenes permitidos:`, allowedOrigins);
        callback(new Error('No permitido por CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  app.setGlobalPrefix('api');
  app.use(cookieParser());

  await app.listen(process.env.PORT ?? 8080);
}
void bootstrap();
