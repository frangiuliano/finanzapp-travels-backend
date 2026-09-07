import { matchStatementLines } from './duplicate-matcher';
import type { DuplicateCandidateExpense } from './duplicate-matcher';

describe('matchStatementLines', () => {
  const farmacityExpense: DuplicateCandidateExpense = {
    id: 'existing-farmacity',
    amount: 22127.5,
    currency: 'ARS',
    description: 'Farmacity sucursal 216',
    merchantName: undefined,
    expenseDate: new Date('2026-08-06T00:00:00.000Z'),
  };

  it('marca como duplicado un gasto ya cargado con mismo monto y fecha cercana', () => {
    const [match] = matchStatementLines(
      [
        {
          date: '2026-08-06',
          amount: 22127.5,
          currency: 'ARS',
          description: 'FARMACITY 216',
        },
      ],
      [farmacityExpense],
    );
    expect(match?.expenseId).toBe('existing-farmacity');
  });

  it('no marca como duplicado si el monto difiere', () => {
    const [match] = matchStatementLines(
      [
        {
          date: '2026-08-06',
          amount: 999.99,
          currency: 'ARS',
          description: 'FARMACITY 216',
        },
      ],
      [farmacityExpense],
    );
    expect(match).toBeNull();
  });

  it('no marca como duplicado si la fecha está fuera de la ventana de días', () => {
    const [match] = matchStatementLines(
      [
        {
          date: '2026-08-20',
          amount: 22127.5,
          currency: 'ARS',
          description: 'FARMACITY 216',
        },
      ],
      [farmacityExpense],
    );
    expect(match).toBeNull();
  });

  it('no marca como duplicado si la moneda difiere', () => {
    const [match] = matchStatementLines(
      [
        {
          date: '2026-08-06',
          amount: 22127.5,
          currency: 'USD',
          description: 'FARMACITY 216',
        },
      ],
      [farmacityExpense],
    );
    expect(match).toBeNull();
  });

  it('sigue matcheando aunque la descripción cargada no se parezca en nada a la del resumen', () => {
    // Caso planteado por el usuario: "Lavavajillas" (descripción propia)
    // vs "Fravega Suc 123" (texto crudo del banco) — el texto nunca debe
    // ser una condición de exclusión, solo monto+moneda+fecha lo son.
    const lavavajillasExpense: DuplicateCandidateExpense = {
      id: 'existing-lavavajillas',
      amount: 100,
      currency: 'ARS',
      description: 'Lavavajillas',
      expenseDate: new Date('2026-08-10T00:00:00.000Z'),
    };
    const [match] = matchStatementLines(
      [
        {
          date: '2026-08-10',
          amount: 100,
          currency: 'ARS',
          description: 'Fravega Suc 123',
        },
      ],
      [lavavajillasExpense],
    );
    expect(match?.expenseId).toBe('existing-lavavajillas');
  });

  it('agrupa un consumo partido por el banco (cargo + propina) y matchea la suma', () => {
    // Caso real: "PedidosYa $1.100" cargado como un solo gasto, pero el
    // resumen lo separa en "PedidosYa Market $1.000" + "PedidosYa Propina
    // $100" en fechas distintas (la propina suele postear un día después).
    const pedidosYaExpense: DuplicateCandidateExpense = {
      id: 'existing-pedidosya',
      amount: 1100,
      currency: 'ARS',
      description: 'PedidosYa',
      expenseDate: new Date('2026-07-31T00:00:00.000Z'),
    };
    const [marketMatch, propinaMatch] = matchStatementLines(
      [
        {
          date: '2026-07-31',
          amount: 1000,
          currency: 'ARS',
          description: 'PEDIDOSYA*MARKET',
        },
        {
          date: '2026-08-01',
          amount: 100,
          currency: 'ARS',
          description: 'DLO*PEDIDOSYA PROPINA',
        },
      ],
      [pedidosYaExpense],
    );

    expect(marketMatch?.expenseId).toBe('existing-pedidosya');
    expect(propinaMatch?.expenseId).toBe('existing-pedidosya');
  });

  it('no agrupa líneas sin ninguna palabra en común aunque sumen el monto correcto', () => {
    const otherExpense: DuplicateCandidateExpense = {
      id: 'existing-other',
      amount: 1100,
      currency: 'ARS',
      description: 'Algo sin relación',
      expenseDate: new Date('2026-07-31T00:00:00.000Z'),
    };
    const [first, second] = matchStatementLines(
      [
        {
          date: '2026-07-31',
          amount: 1000,
          currency: 'ARS',
          description: 'SUPERMERCADO XYZ',
        },
        {
          date: '2026-08-01',
          amount: 100,
          currency: 'ARS',
          description: 'FARMACIA ABC',
        },
      ],
      [otherExpense],
    );

    expect(first).toBeNull();
    expect(second).toBeNull();
  });

  it('no vuelve a usar un gasto que ya fue reclamado por otra línea', () => {
    const singleExpense: DuplicateCandidateExpense = {
      id: 'existing-1',
      amount: 500,
      currency: 'ARS',
      description: 'UBER',
      expenseDate: new Date('2026-08-01T00:00:00.000Z'),
    };
    const [first, second] = matchStatementLines(
      [
        {
          date: '2026-08-01',
          amount: 500,
          currency: 'ARS',
          description: 'PAYU*AR*UBER',
        },
        {
          date: '2026-08-01',
          amount: 500,
          currency: 'ARS',
          description: 'PAYU*AR*UBER',
        },
      ],
      [singleExpense],
    );

    expect(first?.expenseId).toBe('existing-1');
    expect(second).toBeNull();
  });
});
