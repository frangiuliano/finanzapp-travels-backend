import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { CreateShortcutTokenDto } from './dto/create-shortcut-token.dto';
import { UpdateShortcutTokenDto } from './dto/update-shortcut-token.dto';
import { ShortcutIntegrationsService } from './shortcut-integrations.service';

@Controller('shortcut-integrations')
@UseGuards(JwtAuthGuard)
export class ShortcutIntegrationsController {
  constructor(private readonly service: ShortcutIntegrationsService) {}

  @Get()
  list(@GetUser('_id') userId: string) {
    return this.service.listTokens(userId);
  }

  @Post()
  create(@GetUser('_id') userId: string, @Body() dto: CreateShortcutTokenDto) {
    return this.service.createToken(userId, dto);
  }

  @Patch(':id')
  update(
    @GetUser('_id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateShortcutTokenDto,
  ) {
    return this.service.updateToken(userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@GetUser('_id') userId: string, @Param('id') id: string) {
    return this.service.revokeToken(userId, id);
  }
}
