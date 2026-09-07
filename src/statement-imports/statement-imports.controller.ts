import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { StatementImportsService } from './statement-imports.service';
import { UploadStatementDto } from './dto/upload-statement.dto';
import { ConfirmStatementImportDto } from './dto/confirm-statement-import.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';

const MAX_STATEMENT_FILE_SIZE = 5 * 1024 * 1024;

@Controller('statement-imports')
@UseGuards(JwtAuthGuard)
export class StatementImportsController {
  constructor(
    private readonly statementImportsService: StatementImportsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_STATEMENT_FILE_SIZE },
      fileFilter: (_req, file, callback) => {
        if (file.mimetype !== 'application/pdf') {
          callback(
            new BadRequestException('El archivo debe ser un PDF'),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadStatementDto,
    @GetUser('_id') userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Falta el archivo del resumen');
    }

    const result = await this.statementImportsService.processUpload(
      file.buffer,
      dto.boardId,
      dto.paymentMethodId,
      userId,
    );

    return result;
  }

  @Get(':importId')
  async getSession(
    @Param('importId') importId: string,
    @GetUser('_id') userId: string,
  ) {
    const session = await this.statementImportsService.getSession(
      importId,
      userId,
    );
    return {
      importId: session._id.toString(),
      lines: session.lines,
      stats: {
        totalLines: session.lines.length,
        possibleDuplicates: session.lines.filter((l) => l.isPossibleDuplicate)
          .length,
        lowConfidenceDocument: session.lowConfidenceDocument,
      },
      periodFrom: session.periodFrom,
      periodTo: session.periodTo,
    };
  }

  @Post(':importId/confirm')
  async confirm(
    @Param('importId') importId: string,
    @Body() dto: ConfirmStatementImportDto,
    @GetUser('_id') userId: string,
  ) {
    return this.statementImportsService.confirm(importId, userId, dto);
  }

  @Delete(':importId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(
    @Param('importId') importId: string,
    @GetUser('_id') userId: string,
  ) {
    await this.statementImportsService.cancel(importId, userId);
  }
}
