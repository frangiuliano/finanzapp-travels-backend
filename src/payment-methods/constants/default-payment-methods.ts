import { PaymentMethodKind } from '../payment-method.schema';

export const DEFAULT_CASH_PAYMENT_METHOD_NAME = 'Efectivo / Transferencia';

export const DEFAULT_PAYMENT_METHODS = [
  {
    name: DEFAULT_CASH_PAYMENT_METHOD_NAME,
    kind: PaymentMethodKind.CASH,
  },
] as const;
