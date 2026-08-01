import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './user.schema';
import { UserPreferencesService } from './user-preferences.service';
import { BoardsModule } from '../trips/trips.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    forwardRef(() => BoardsModule),
  ],
  providers: [UserPreferencesService],
  exports: [UserPreferencesService, MongooseModule],
})
export class UsersModule {}
