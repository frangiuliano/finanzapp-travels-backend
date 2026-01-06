import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { User, UserSchema } from '../users/user.schema';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { APP_GUARD } from '@nestjs/core';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      // Note: Using 'as any' is necessary due to type incompatibility
      // between ConfigService return type and JwtModuleOptions.expiresIn
      useFactory: (configService: ConfigService): any => {
        const jwtSecret = configService.get<string>('JWT_SECRET');
        const expiresIn = configService.get<string>('JWT_EXPIRES_IN', '1h');

        if (!jwtSecret) {
          throw new Error('JWT_SECRET no está configurado');
        }

        return {
          secret: jwtSecret,
          signOptions: {
            expiresIn: expiresIn,
          },
        };
      },
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    NotificationsModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
