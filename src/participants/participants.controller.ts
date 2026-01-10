import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ParticipantsService } from './participants.service';
import {
  InviteParticipantDto,
  AddGuestParticipantDto,
  SendInvitationToGuestDto,
} from './dto/index';
import { InvitationDocument } from './schemas/invitation.schema';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { GetUserOptional } from '../auth/decorators/get-user-optional.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('participants')
@UseGuards(JwtAuthGuard)
export class ParticipantsController {
  constructor(private readonly participantsService: ParticipantsService) {}

  @Post('invite')
  @HttpCode(HttpStatus.CREATED)
  async invite(
    @Body() inviteDto: InviteParticipantDto,
    @GetUser('_id') userId: string,
  ) {
    const invitation = await this.participantsService.inviteParticipant(
      inviteDto,
      userId,
    );
    return {
      message: 'Invitación enviada exitosamente',
      invitation,
    };
  }

  @Post('guest')
  @HttpCode(HttpStatus.CREATED)
  async addGuest(
    @Body() dto: AddGuestParticipantDto,
    @GetUser('_id') userId: string,
  ) {
    const participant = await this.participantsService.addGuestParticipant(
      dto,
      userId,
    );
    return {
      message: 'Invitado añadido exitosamente',
      participant,
    };
  }

  @Post('guest/:participantId/invite')
  @HttpCode(HttpStatus.CREATED)
  async inviteGuest(
    @Param('participantId') participantId: string,
    @Body() dto: SendInvitationToGuestDto,
    @GetUser('_id') userId: string,
  ) {
    const invitation = (await this.participantsService.sendInvitationToGuest(
      participantId,
      dto.email,
      userId,
    )) as InvitationDocument;
    return {
      message: 'Invitación enviada exitosamente al invitado',
      invitation,
    };
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
    const participants = await this.participantsService.findByTrip(
      tripId,
      userId,
    );
    return {
      participants,
    };
  }

  @Get('trip/:tripId/invitations')
  async getPendingInvitations(
    @Param('tripId') tripId: string,
    @GetUser('_id') userId: string,
  ) {
    return this.participantsService.getPendingInvitations(tripId, userId);
  }

  @Delete('trip/:tripId/participant/:participantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeParticipant(
    @Param('tripId') tripId: string,
    @Param('participantId') participantId: string,
    @GetUser('_id') userId: string,
  ) {
    await this.participantsService.removeParticipant(
      tripId,
      participantId,
      userId,
    );
  }
}
