import { PDFParse } from 'pdf-parse';

/**
 * Extracts plain text from a PDF buffer. The buffer must already be in
 * memory (multer memoryStorage) — nothing here touches disk, so the
 * original file never outlives this call.
 */
export async function extractStatementText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}
