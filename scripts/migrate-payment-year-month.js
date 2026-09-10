/**
 * Migration: backfills Expense.paymentYearMonth for existing documents.
 *
 * Two steps, run in order (mirrors ExpensesService.onModuleInit(), which
 * runs this automatically on every backend startup — this script exists for
 * manual inspection/dry-runs, e.g. before a deploy):
 *
 * 1. Where billingCycleLabel is set, copy it to paymentYearMonth. This only
 *    ever existed for credit-card expenses with a configured closing day.
 * 2. Everything still missing paymentYearMonth (cash/debit expenses, cards
 *    without a closing day, every materialized installment cuota, and every
 *    local-currency recurring occurrence never had billingCycleLabel at
 *    all) falls back to the calendar month of its own expenseDate.
 *
 * Usage:
 *   MONGODB_URI="mongodb://127.0.0.1:27017/finanzapp-local" node scripts/migrate-payment-year-month.js
 *   MONGODB_URI="..." node scripts/migrate-payment-year-month.js --apply
 *
 * Without --apply it only reports how many documents it would touch.
 */

const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const APPLY = process.argv.includes('--apply');

async function main() {
  if (!MONGODB_URI) {
    console.error('Falta la variable de entorno MONGODB_URI');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db();
  const expenses = db.collection('expenses');

  const cycleLabelFilter = {
    paymentYearMonth: { $exists: false },
    billingCycleLabel: { $type: 'string' },
  };
  const cycleLabelMatched = await expenses.countDocuments(cycleLabelFilter);
  console.log(`Paso 1 — desde billingCycleLabel: ${cycleLabelMatched} gastos`);

  if (APPLY) {
    const result = await expenses.updateMany(cycleLabelFilter, [
      { $set: { paymentYearMonth: '$billingCycleLabel' } },
    ]);
    console.log(`  Actualizados: ${result.modifiedCount}`);
  }

  const fallbackFilter = { paymentYearMonth: { $exists: false } };
  const fallbackMatched = await expenses.countDocuments(fallbackFilter);
  console.log(
    `Paso 2 — desde expenseDate (todavía sin paymentYearMonth): ${fallbackMatched} gastos`,
  );

  if (!APPLY) {
    console.log(
      'Dry-run: no se modificó nada. Corré con --apply para aplicar.',
    );
  } else {
    const result = await expenses.updateMany(fallbackFilter, [
      {
        $set: {
          paymentYearMonth: {
            $dateToString: { format: '%Y-%m', date: '$expenseDate' },
          },
        },
      },
    ]);
    console.log(`  Actualizados: ${result.modifiedCount}`);
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
