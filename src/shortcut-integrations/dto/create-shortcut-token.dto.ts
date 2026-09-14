import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ShortcutCaptureMode } from '../shortcut-integration.schema';

export class CreateShortcutTokenDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsEnum(ShortcutCaptureMode)
  mode?: ShortcutCaptureMode;
}
