import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum BoardType {
  EVERYDAY = 'everyday',
  TRAVEL = 'travel',
}

@Schema({ timestamps: true, collection: 'trips' })
export class Board {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, default: 'USD' })
  baseCurrency: string;

  @Prop({
    type: String,
    enum: BoardType,
    required: true,
    default: BoardType.TRAVEL,
  })
  type: BoardType;

  @Prop({ type: Types.ObjectId, ref: 'Board', required: false, index: true })
  parentBoardId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, required: false, index: true })
  archivedAt?: Date;
}

export type BoardDocument = Board & Document;

export const BoardSchema = SchemaFactory.createForClass(Board);
