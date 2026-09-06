import { findPossibleDuplicate } from './duplicate-matcher';

describe('findPossibleDuplicate', () => {
  const existingExpense = {
    id: 'existing-1',
    amount: 22127.5,
    currency: 'ARS',
    description: 'Farmacity sucursal 216',
    merchantName: undefined,
    expenseDate: new Date('2026-08-06T00:00:00.000Z'),
  };

  it('marca como duplicado un gasto ya cargado con mismo monto y fecha cercana', () => {
    const match = findPossibleDuplicate(
      {
        date: '2026-08-06',
        amount: 22127.5,
        currency: 'ARS',
        description: 'FARMACITY 216',
      },
      [existingExpense],
    );
    expect(match?.id).toBe('existing-1');
  });

  it('no marca como duplicado si el monto difiere', () => {
    const match = findPossibleDuplicate(
      {
        date: '2026-08-06',
        amount: 999.99,
        currency: 'ARS',
        description: 'FARMACITY 216',
      },
      [existingExpense],
    );
    expect(match).toBeNull();
  });

  it('no marca como duplicado si la fecha está fuera de la ventana de días', () => {
    const match = findPossibleDuplicate(
      {
        date: '2026-08-20',
        amount: 22127.5,
        currency: 'ARS',
        description: 'FARMACITY 216',
      },
      [existingExpense],
    );
    expect(match).toBeNull();
  });

  it('no marca como duplicado si la moneda difiere', () => {
    const match = findPossibleDuplicate(
      {
        date: '2026-08-06',
        amount: 22127.5,
        currency: 'USD',
        description: 'FARMACITY 216',
      },
      [existingExpense],
    );
    expect(match).toBeNull();
  });
});
