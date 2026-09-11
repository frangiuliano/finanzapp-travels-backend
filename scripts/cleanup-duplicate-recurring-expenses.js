/**
 * Cleanup: removes duplicate PENDING occurrences of a recurring expense rule
 * for the same month.
 *
 * Root cause (fixed in RecurringExpensesService.update() /
 * RecurringMaterializationService): editing a recurring expense's
 * dayOfMonth only updated the rule, not the already-materialized pending
 * occurrence. The next ensureHorizon() call then generated a *new*
 * occurrence for the new day (its occurrenceKey embeds the day), leaving
 * the old-day occurrence orphaned alongside it — two "Próximo" expenses for
 * the same month.
 *
 * This script finds, per recurring expense rule and paymentYearMonth,
 * groups of more than one PENDING/non-skipped occurrence, keeps the one
 * whose day matches the rule's *current* dayOfMonth (the one a normal edit
 * intended to keep) and deletes the rest. Paid history is never touched
 * (status filter). Ambiguous groups (none/multiple match the current day)
 * are reported but left untouched for manual review.
 *
 * Usage:
 *   MONGODB_URI="mongodb://127.0.0.1:27017/finanzapp-local" node scripts/cleanup-duplicate-recurring-expenses.js
 *   MONGODB_URI="..." node scripts/cleanup-duplicate-recurring-expenses.js --apply
 *
 * Without --apply it only reports what it would delete.
 */

const { MongoClient, ObjectId } = require('mongodb');

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
  const recurringExpenses = db.collection('recurringexpenses');

  const groups = await expenses
    .aggregate([
      {
        $match: {
          recurringExpenseId: { $exists: true },
          status: 'pending',
          skippedAt: { $exists: false },
        },
      },
      {
        $group: {
          _id: {
            recurringExpenseId: '$recurringExpenseId',
            paymentYearMonth: '$paymentYearMonth',
          },
          count: { $sum: 1 },
          docs: {
            $push: {
              _id: '$_id',
              expenseDate: '$expenseDate',
              amount: '$amount',
            },
          },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  if (groups.length === 0) {
    console.log('No se encontraron duplicados.');
    await client.close();
    return;
  }

  console.log(`Grupos duplicados encontrados: ${groups.length}\n`);

  const ruleCache = new Map();
  let toDelete = [];
  let ambiguous = 0;

  for (const group of groups) {
    const ruleId = group._id.recurringExpenseId.toString();
    if (!ruleCache.has(ruleId)) {
      ruleCache.set(
        ruleId,
        await recurringExpenses.findOne({ _id: new ObjectId(ruleId) }),
      );
    }
    const rule = ruleCache.get(ruleId);

    console.log(
      `Regla ${ruleId} (${rule ? rule.label : '¿borrada?'}) — mes ${group._id.paymentYearMonth} — ${group.count} ocurrencias:`,
    );
    for (const doc of group.docs) {
      const day = new Date(doc.expenseDate).getUTCDate();
      console.log(
        `  - ${doc._id} | día ${day} | monto ${doc.amount}${rule && day === rule.dayOfMonth ? '  <- coincide con dayOfMonth actual' : ''}`,
      );
    }

    if (!rule) {
      console.log('  Regla no encontrada, se omite (revisar manualmente).\n');
      ambiguous += 1;
      continue;
    }

    const matching = group.docs.filter(
      (doc) => new Date(doc.expenseDate).getUTCDate() === rule.dayOfMonth,
    );

    if (matching.length !== 1) {
      console.log(
        `  Ambiguo (${matching.length} coinciden con dayOfMonth=${rule.dayOfMonth}), se omite.\n`,
      );
      ambiguous += 1;
      continue;
    }

    const keepId = matching[0]._id.toString();
    const removeIds = group.docs
      .filter((doc) => doc._id.toString() !== keepId)
      .map((doc) => doc._id);

    console.log(`  Se conserva ${keepId}, se borran ${removeIds.length}.\n`);
    toDelete = toDelete.concat(removeIds);
  }

  console.log(`Total a borrar: ${toDelete.length}`);
  if (ambiguous > 0) {
    console.log(`Grupos ambiguos sin tocar: ${ambiguous} (revisar a mano).`);
  }

  if (!APPLY) {
    console.log('\nDry-run: no se borró nada. Corré con --apply para aplicar.');
  } else if (toDelete.length > 0) {
    const result = await expenses.deleteMany({ _id: { $in: toDelete } });
    console.log(`\nBorrados: ${result.deletedCount}`);
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
