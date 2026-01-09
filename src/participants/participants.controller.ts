import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ParticipantsService } from './participants.service';
import { InviteParticipantDto } from './dto';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { GetUserOptional } from '../auth/decorators/get-user-optional.decorator';
import { Public } from '../auth/decorators/public.decorator';

@Controller('participants')
export class ParticipantsController {
  constructor(private readonly participantsService: ParticipantsService) {}

  @Post('invite')
  @HttpCode(HttpStatus.CREATED)
  async invite(
    @Body() inviteDto: InviteParticipantDto,
    @GetUser('_id') userId: string,
  ) {
    return this.participantsService.inviteParticipant(inviteDto, userId);
  }

  @Public()
  @Get('invitation/:token')
  async getInvitationInfo(@Param('token') token: string) {
    return this.participantsService.getInvitationInfo(token);
  }

  @Public()
  @Post('invitation/:token/accept')
  @HttpCode(HttpStatus.OK)
  async acceptInvitation(
    @Param('token') token: string,
    @GetUserOptional('_id') userId?: string,
  ) {
    return this.participantsService.acceptInvitation(token, userId);
  }

  @Delete('invitation/:invitationId')
  @HttpCode(HttpStatus.OK)
  async cancelInvitation(
    @Param('invitationId') invitationId: string,
    @GetUser('_id') userId: string,
  ) {
    return this.participantsService.cancelInvitation(invitationId, userId);
  }

  @Get('trip/:tripId')
  async getParticipants(
    @Param('tripId') tripId: string,
    @GetUser('_id') userId: string,
  ) {
    return this.participantsService.findByTrip(tripId, userId);
  }

  @Get('trip/:tripId/invitations')
  async getPendingInvitations(
    @Param('tripId') tripId: string,
    @GetUser('_id') userId: string,
  ) {
    return this.participantsService.getPendingInvitations(tripId, userId);
  }

  @Delete('trip/:tripId/user/:participantUserId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeParticipant(
    @Param('tripId') tripId: string,
    @Param('participantUserId') participantUserId: string,
    @GetUser('_id') userId: string,
  ) {
    return this.participantsService.removeParticipant(
      tripId,
      participantUserId,
      userId,
    );
  }
}
