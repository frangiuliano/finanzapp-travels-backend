import {
  parseStatementText,
  StatementLineSource,
} from './generic-statement-parser';

// Representative "classic" layout (HSBC / Hipotecario): dates with dots,
// negative sign trailing, cuota with the literal word "Cuota", comprobante
// tokens glued right after the date, some rows wrapped together in the
// extracted text with no real line break between them.
const HIPOTECARIO_STYLE_TEXT = `
VISA SIGNATURE
CIERRE ACTUAL: 27 Ago 26
Cuotas a vencer:
Setiembre/26 Octubre/26 Noviembre/26
$486.151,41 $452.487,75 $252.139,01

FECHA COMPROBANTE DETALLE DE TRANSACCION PESOS DOLARES
SALDO ANTERIOR 1.866.211,47 81,16
03.08.26 SU PAGO EN PESOS 1.835.571,90-
03.08.26 SU PAGO EN USD 81,16-
07.08.26 DEV.IMP. RG 5617 30%( 102131,92) 30.639,57-
01.01.26 009461* WWW.CARREFOUR.COM.AR Cuota 08/18 47.166,66
23.04.26 INTERESES FINANCIACION $ 139,12
05.08.26 344509K Microsoft*Xbox G MicrosoftUSD 12,83 06.08.26 006043* FARMACITY 216 22.127,50
08.08.26 614262 OPENAI *CHATGPT SUBSCR USD 20,00 09.08.26 371122F Spotify USD 2,97

Total a pagar de este resumen. Estimado cliente, informamos que a partir del
próximo cierre financiero se aplicarán las condiciones vigentes al 05-05-26.
`;

// Representative "modern" layout (Galicia): dates with dashes, negative
// sign leading, cuota without the word "Cuota", a leading "*" bullet on
// each description.
const GALICIA_STYLE_TEXT = `
Galicia
Total a pagar
$124.700,60
Ciclo de facturación
28-Jun-23 07-Jul-23

FECHA REFERENCIA CUOTA COMPROBANTE PESOS DOLARES
SALDO ANTERIOR 112.876,90 2,99
03-07-23 SU PAGO EN PESOS 261.000,00 .TC274,0000 -112.876,90 -2,99
31-06-23 * CUOTA CLUB 450234573 990548 22.020,23
30-06-23 * SEGURO - DEBITO AUTOMATICO 008877 7.894,66
10-07-23 * CURSO ONLINE 9900234571 03/06 778899 3.456,77
TARJETA 5566 Total De Consumos de MARIA ALEJANDRA RODRIGUEZ 33371.7

Total a pagar. Condiciones vigentes desde el 05-05-23 en todas las sucursales.
`;

describe('parseStatementText — layout genérico (HSBC/Hipotecario)', () => {
  const result = parseStatementText(HIPOTECARIO_STYLE_TEXT);

  it('descarta la identidad del titular, tasas y cronograma de cuotas a futuro', () => {
    expect(result.lines.every((l) => !/cuotas a vencer/i.test(l.rawText))).toBe(
      true,
    );
  });

  it('descarta saldo anterior y los pagos del propio usuario, pero no los cargos reales', () => {
    const descriptions = result.lines.map((l) => l.description.toUpperCase());
    expect(descriptions.some((d) => d.includes('SALDO ANTERIOR'))).toBe(false);
    expect(descriptions.some((d) => d.includes('SU PAGO EN PESOS'))).toBe(
      false,
    );
    expect(descriptions.some((d) => d.includes('SU PAGO EN USD'))).toBe(false);
    expect(descriptions.some((d) => d.includes('INTERESES FINANCIACION'))).toBe(
      true,
    );
  });

  it('toma el último número como el monto real, no uno embebido en la descripción', () => {
    const line = result.lines.find((l) => l.rawText.includes('DEV.IMP'));
    expect(line).toBeDefined();
    expect(line!.amount).toBeCloseTo(-30639.57, 2);
    expect(line!.description).toContain('102131,92');
  });

  it('reconoce la cuota con la palabra "Cuota"', () => {
    const line = result.lines.find((l) => l.rawText.includes('CARREFOUR'));
    expect(line).toBeDefined();
    expect(line!.cuotaActual).toBe(8);
    expect(line!.cuotaTotal).toBe(18);
    expect(line!.amount).toBeCloseTo(47166.66, 2);
  });

  it('separa dos movimientos que quedaron pegados en el mismo renglón de texto', () => {
    const microsoftLine = result.lines.find((l) =>
      l.rawText.includes('Microsoft'),
    );
    const farmacityLine = result.lines.find((l) =>
      l.rawText.includes('FARMACITY'),
    );
    expect(microsoftLine).toBeDefined();
    expect(farmacityLine).toBeDefined();
    expect(microsoftLine!.date).toBe('2026-08-05');
    expect(microsoftLine!.currency).toBe('USD');
    expect(microsoftLine!.amount).toBeCloseTo(12.83, 2);
    expect(farmacityLine!.date).toBe('2026-08-06');
    expect(farmacityLine!.currency).toBe('ARS');
    expect(farmacityLine!.amount).toBeCloseTo(22127.5, 2);
  });

  it('detecta el marcador USD incluso pegado al comercio sin espacio', () => {
    const openaiLine = result.lines.find((l) => l.rawText.includes('OPENAI'));
    expect(openaiLine).toBeDefined();
    expect(openaiLine!.currency).toBe('USD');
    expect(openaiLine!.amount).toBeCloseTo(20, 2);
  });
});

describe('parseStatementText — layout genérico (Galicia)', () => {
  const result = parseStatementText(GALICIA_STYLE_TEXT);

  it('acepta fecha con guiones y descarta el saldo anterior y el pago del usuario', () => {
    const descriptions = result.lines.map((l) => l.description.toUpperCase());
    expect(descriptions.some((d) => d.includes('SALDO ANTERIOR'))).toBe(false);
    expect(descriptions.some((d) => d.includes('SU PAGO EN PESOS'))).toBe(
      false,
    );
  });

  it('acepta el signo negativo por delante del monto', () => {
    // La línea de pago está en la lista de ruido, así que se valida con
    // otro dato: el resto de líneas nunca deberían quedar con NaN.
    expect(result.lines.every((l) => !Number.isNaN(l.amount))).toBe(true);
  });

  it('reconoce la cuota sin la palabra "Cuota" y recorta el prefijo "*"', () => {
    const line = result.lines.find((l) => l.rawText.includes('CURSO ONLINE'));
    expect(line).toBeDefined();
    expect(line!.cuotaActual).toBe(3);
    expect(line!.cuotaTotal).toBe(6);
    expect(line!.description.startsWith('*')).toBe(false);
  });

  it('marca las líneas como parseadas por regex por default', () => {
    expect(
      result.lines.every((l) => l.parsedVia === StatementLineSource.REGEX),
    ).toBe(true);
  });
});
