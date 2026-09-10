/**
 * Backfill: marks closingDayReviewed = true on installment cuotas whose
 * expenseDate already lands exactly on their card's current closing day.
 *
 * Scope: only touches Expense documents that have installmentPlanId set.
 * Regular one-off expenses are never touched (their closing-day coincidence
 * is a real ambiguity a human should confirm, not a backfill candidate).
 *
 * Usage:
 *   MONGODB_URI="mongodb://127.0.0.1:27017/finanzapp-local" node scripts/backfill-closing-day-reviewed.js
 *   MONGODB_URI="..." node scripts/backfill-closing-day-reviewed.js --apply
 *
 * Without --apply it only reports how many documents it would touch.
 */

const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const APPLY = process.argv.includes('--apply');

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

async function main() {
  if (!MONGODB_URI) {
    console.error('Falta la variable de entorno MONGODB_URI');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db();
  const expenses = db.collection('expenses');
  const paymentMethods = db.collection('paymentmethods');

  const cursor = expenses.find({
    installmentPlanId: { $exists: true, $ne: null },
    closingDayReviewed: { $ne: true },
  });

  const methodCache = new Map();
  let scanned = 0;
  const matchedIds = [];

  for await (const expense of cursor) {
    scanned += 1;
    const methodId = expense.paymentMethodId || expense.cardId;
    if (!methodId) continue;

    const key = methodId.toString();
    let method = methodCache.get(key);
    if (method === undefined) {
      method = (await paymentMethods.findOne({ _id: methodId })) || null;
      methodCache.set(key, method);
    }
    if (!method || method.kind !== 'credit' || method.closingDay == null) {
      continue;
    }

    const date = new Date(expense.expenseDate);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const effectiveClosingDay = Math.min(
      method.closingDay,
      daysInMonth(year, month),
    );

    if (day === effectiveClosingDay) {
      matchedIds.push(expense._id);
    }
  }

  console.log(
    `Cuotas escaneadas (installmentPlanId, no revisadas): ${scanned}`,
  );
  console.log(
    `Coinciden con el cierre actual de su tarjeta: ${matchedIds.length}`,
  );

  if (!APPLY) {
    console.log(
      'Dry-run: no se modificó nada. Corré con --apply para aplicar.',
    );
  } else {
    const result = await expenses.updateMany(
      { _id: { $in: matchedIds.map((id) => new ObjectId(id)) } },
      { $set: { closingDayReviewed: true } },
    );
    console.log(`Actualizados: ${result.modifiedCount}`);
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
