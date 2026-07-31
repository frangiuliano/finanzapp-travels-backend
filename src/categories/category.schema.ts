import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Category {
  @Prop({ type: Types.ObjectId, ref: 'Board', required: true })
  tripId: Types.ObjectId;

  @Prop({ required: true, maxlength: 100, trim: true })
  name: string;

  @Prop({ maxlength: 50 })
  icon?: string;

  @Prop({ maxlength: 20 })
  color?: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  isDefault: boolean;
}

export type CategoryDocument = Category & Document;

export const CategorySchema = SchemaFactory.createForClass(Category);

CategorySchema.index({ tripId: 1, name: 1 });
CategorySchema.index({ tripId: 1, isActive: 1 });
