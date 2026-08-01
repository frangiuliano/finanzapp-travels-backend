import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { BoardsService } from '../../trips/trips.service';
import { BoardType } from '../../trips/board.schema';
import { UserPreferencesService } from '../../users/user-preferences.service';
import { BotUpdateDocument, ConversationState } from '../bot-update.schema';
import { TelegramClientService } from '../telegram/telegram-client.service';
import { getDocumentId } from '../utils/bot-helpers';

function boardTypeEmoji(type: BoardType): string {
  return type === BoardType.EVERYDAY ? '🏠' : '✈️';
}

function boardTypeLabel(type: BoardType): string {
  return type === BoardType.EVERYDAY ? 'Everyday' : 'Viaje';
}

@Injectable()
export class BoardCommandHandler {
  constructor(
    private boardsService: BoardsService,
    private userPreferencesService: UserPreferencesService,
    private telegramClient: TelegramClientService,
  ) {}

  async handle(
    botUpdate: BotUpdateDocument,
    text: string,
    telegramUserId: number,
  ): Promise<void> {
    const userId = botUpdate.userId!.toString();
    const boards = (await this.boardsService.findAll(
      userId,
    )) as unknown as Array<
      { name: string; type?: BoardType } & Record<string, unknown>
    >;

    if (boards.length === 0) {
      await this.telegramClient.sendMessage(
        telegramUserId,
        '⚠️ No tenés tableros todavía. Creá uno desde la web y volvé a intentar.',
      );
      return;
    }

    const parts = text.trim().split(/\s+/);
    const selection = parts.slice(1).join(' ').trim();

    if (!selection) {
      await this.listBoards(botUpdate, telegramUserId, boards);
      return;
    }

    const activeBoardId =
      await this.userPreferencesService.getActiveBoardId(userId);

    const matched = this.matchBoard(boards, selection, activeBoardId);
    if (!matched) {
      await this.telegramClient.sendMessage(
        telegramUserId,
        '⚠️ No encontré ese tablero. Usá /board para ver la lista o tocá un botón.',
      );
      return;
    }

    await this.setActiveBoard(
      botUpdate,
      telegramUserId,
      getDocumentId(matched),
      matched.name,
      matched.type ?? BoardType.TRAVEL,
    );
  }

  async handleBoardCallback(
    botUpdate: BotUpdateDocument,
    boardId: string,
    telegramUserId: number,
  ): Promise<void> {
    const userId = botUpdate.userId!.toString();
    const board = await this.boardsService.findOne(boardId, userId);
    await this.setActiveBoard(
      botUpdate,
      telegramUserId,
      boardId,
      board.name,
      board.type ?? BoardType.TRAVEL,
    );
  }

  private async listBoards(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
    boards: Array<{ name: string; type?: BoardType } & Record<string, unknown>>,
  ): Promise<void> {
    const activeBoardId = await this.userPreferencesService.getActiveBoardId(
      botUpdate.userId!.toString(),
    );

    const lines = boards.map((board, index) => {
      const id = getDocumentId(board);
      const active = id === activeBoardId ? ' ✅' : '';
      const type = board.type ?? BoardType.TRAVEL;
      return `${index + 1}. ${boardTypeEmoji(type)} ${board.name} (${boardTypeLabel(type)})${active}`;
    });

    const message =
      '📋 *Tus tableros*\n\n' +
      lines.join('\n') +
      '\n\nTocá un tablero para activarlo o escribí:\n`/board <nombre>`';

    const buttons = boards.slice(0, 10).map((board) => {
      const id = getDocumentId(board);
      const type = board.type ?? BoardType.TRAVEL;
      const isActive = id === activeBoardId;
      return {
        text: `${isActive ? '✅ ' : ''}${boardTypeEmoji(type)} ${board.name}`,
        callback_data: `board:${id}`,
      };
    });

    await this.telegramClient.sendMessageWithButtons(
      telegramUserId,
      message,
      buttons,
    );
  }

  private matchBoard(
    boards: Array<{ name: string; type?: BoardType } & Record<string, unknown>>,
    selection: string,
    activeBoardId: string | null,
  ):
    | ({ name: string; type?: BoardType } & Record<string, unknown>)
    | undefined {
    const index = Number.parseInt(selection, 10);
    if (!Number.isNaN(index) && index >= 1 && index <= boards.length) {
      return boards[index - 1];
    }

    const normalized = selection.toLowerCase();
    const byName = boards.find((board) =>
      board.name.toLowerCase().includes(normalized),
    );
    if (byName) {
      return byName;
    }

    if (normalized === 'activo' && activeBoardId) {
      return boards.find((board) => getDocumentId(board) === activeBoardId);
    }

    return undefined;
  }

  private async setActiveBoard(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
    boardId: string,
    boardName: string,
    boardType: BoardType,
  ): Promise<void> {
    const userId = botUpdate.userId!.toString();
    await this.userPreferencesService.setActiveBoardId(userId, boardId);

    botUpdate.currentTripId = new Types.ObjectId(boardId);
    botUpdate.state = ConversationState.IDLE;
    botUpdate.pendingExpense = undefined;
    await botUpdate.save();

    const typeLabel = boardTypeLabel(boardType);
    await this.telegramClient.sendMessage(
      telegramUserId,
      `✅ Tablero activo: *${boardName}* (${typeLabel})\n\n` +
        'Podés cargar gastos enviándome un mensaje.\n' +
        'Ejemplo everyday: "Super 15000"\n' +
        'Ejemplo viaje: "Cena 120 usd compartido"',
    );
  }
}
