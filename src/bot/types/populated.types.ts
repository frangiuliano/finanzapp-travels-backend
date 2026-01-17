import { Types } from 'mongoose';

export interface PopulatedUser {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  email?: string;
}

export interface PopulatedParticipant {
  _id: Types.ObjectId;
  guestName?: string;
  guestEmail?: string;
  userId?: PopulatedUser | Types.ObjectId;
}

export interface PopulatedBudget {
  _id: Types.ObjectId;
  name: string;
  tripId: Types.ObjectId;
  amount: number;
  currency: string;
  spent: number;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
