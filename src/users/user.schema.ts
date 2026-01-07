import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as bcrypt from 'bcrypt';

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true })
  firstName: string;

  @Prop({ required: true })
  lastName: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, select: false })
  password: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  emailVerified: boolean;

  @Prop({ default: null, select: false })
  emailVerificationToken?: string;

  @Prop({ default: null, select: false })
  passwordResetToken?: string;

  @Prop({ default: null, select: false })
  passwordResetExpires?: Date;

  @Prop({ default: Date.now })
  lastLogin?: Date;

  @Prop({ type: [String], default: [], select: false })
  refreshTokens?: string[];
}

export type UserDocument = User &
  Document & {
    comparePassword: (candidatePassword: string) => Promise<boolean>;
  };

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

UserSchema.methods.comparePassword = async function (
  this: UserDocument,
  candidatePassword: string,
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};
