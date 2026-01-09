import { Types } from 'mongoose';
import { Invitation, Participant } from '../schemas';

export interface InvitationInfo {
  invitation: Invitation;
  trip: {
    _id: Types.ObjectId;
    name: string;
    description?: string;
  };
  inviter: {
    firstName: string;
    lastName: string;
  };
  userExists: boolean;
  userEmail: string;
}

export interface AcceptInvitationResult {
  success: boolean;
  message: string;
  requiresRegistration?: boolean;
  email?: string;
  participant?: Participant;
}
