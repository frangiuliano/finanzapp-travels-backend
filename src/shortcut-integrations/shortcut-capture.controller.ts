import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { CreateShortcutExpenseDto } from './dto/create-shortcut-expense.dto';
import { ResolveShortcutExpenseDto } from './dto/resolve-shortcut-expense.dto';
import { ShortcutIntegrationsService } from './shortcut-integrations.service';
import { ShortcutTokenGuard } from './shortcut-token.guard';

@Public()
@Controller('shortcut-capture')
@UseGuards(ShortcutTokenGuard)
export class ShortcutCaptureController {
  constructor(private readonly service: ShortcutIntegrationsService) {}

  @Get('context')
  context(@Req() request: Request, @Query('boardId') boardId?: string) {
    return this.service.getContext(request.shortcutIdentity!, boardId);
  }

  @Post('resolve')
  resolve(@Req() request: Request, @Body() dto: ResolveShortcutExpenseDto) {
    return this.service.resolveExpense(request.shortcutIdentity!, dto);
  }

  @Post('expenses')
  create(@Req() request: Request, @Body() dto: CreateShortcutExpenseDto) {
    return this.service.createExpense(request.shortcutIdentity!, dto);
  }
}
