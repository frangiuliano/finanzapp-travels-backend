import { InstrumentType } from './wealth.schemas';

export const DEFAULT_INSTRUMENTS = [
  ['AAPL', 'Apple Inc.', InstrumentType.STOCK, 'USD', 'NASDAQ'],
  ['MSFT', 'Microsoft Corporation', InstrumentType.STOCK, 'USD', 'NASDAQ'],
  ['GOOGL', 'Alphabet Inc.', InstrumentType.STOCK, 'USD', 'NASDAQ'],
  ['AMZN', 'Amazon.com Inc.', InstrumentType.STOCK, 'USD', 'NASDAQ'],
  ['SPY', 'SPDR S&P 500 ETF', InstrumentType.ETF, 'USD', 'NYSE'],
  ['QQQ', 'Invesco QQQ ETF', InstrumentType.ETF, 'USD', 'NASDAQ'],
  ['AAPL-CEDEAR', 'CEDEAR Apple', InstrumentType.CEDEAR, 'ARS', 'BYMA'],
  ['SPY-CEDEAR', 'CEDEAR SPY', InstrumentType.CEDEAR, 'ARS', 'BYMA'],
  ['GGAL', 'Grupo Financiero Galicia', InstrumentType.STOCK, 'ARS', 'BYMA'],
  ['YPFD', 'YPF S.A.', InstrumentType.STOCK, 'ARS', 'BYMA'],
  ['AL30', 'Bono República Argentina AL30', InstrumentType.BOND, 'ARS', 'BYMA'],
  ['GD30', 'Bono Global GD30', InstrumentType.BOND, 'USD', 'BYMA'],
  ['BTC', 'Bitcoin', InstrumentType.CRYPTO, 'USD', 'CRYPTO'],
  ['ETH', 'Ethereum', InstrumentType.CRYPTO, 'USD', 'CRYPTO'],
] as const;
