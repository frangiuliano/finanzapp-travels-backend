/**
 * Migration: moves the old Wealth "Objetivos" data (SavingsGoal +
 * GoalAllocation) into the new, independent Goals domain (Goal +
 * GoalHoldingSelection + GoalCheckpoint).
 *
 * Why this migration isn't a simple rename: the old GoalAllocation model
 * PHYSICALLY reserved money — Holding.allocatedBalance was incremented on
 * every contribution, which reduced the "disponible" shown in Patrimonio.
 * The new Goals domain never reserves anything: selecting a holding for a
 * goal is a pure reference used only to *analyze* viability. So migrating
 * data 1:1 isn't enough — every holding's allocatedBalance that was reserved
 * by a goal contribution has to be released back into its available balance,
 * or the new "no reservations" rule would be inconsistent between goals
 * created before and after this migration.
 *
 * What it does, per SavingsGoal:
 *   1. Creates a Goal with the same name/target/currency/date/priority/
 *      status/icon, tagged with legacySavingsGoalId for traceability.
 *   2. For every GoalAllocation with amount > 0, creates a
 *      GoalHoldingSelection (goalId, holdingId) — a reference only, no
 *      amount. The holding stays selected; it just no longer "owns" a
 *      reserved slice of that holding's balance.
 *   3. Releases the reserved money: decrements Holding.allocatedBalance by
 *      the migrated allocation amount (floored at 0) and writes an
 *      auditable WealthEvent (kind: balance_adjustment, amount: 0 — the
 *      holding's real currentBalance never changes, only how much of it was
 *      marked "reserved") explaining why.
 *   4. Writes one GoalCheckpoint for the current month, isBaseline: true,
 *      using each selected holding's current balance (same-currency only,
 *      mirroring GoalsPlannerService's "computable" rule) as the starting
 *      point for future monthly-progress tracking.
 *   5. Marks the SavingsGoal/GoalAllocation documents with migratedAt so a
 *      second run is a no-op (idempotent) — nothing is ever deleted, so a
 *      rollback only means reading the untouched savingsgoals/
 *      goalallocations collections.
 *
 * Usage:
 *   MONGODB_URI="mongodb://127.0.0.1:27017/finanzapp-local" node scripts/migrate-savings-goals-to-goals.js
 *   MONGODB_URI="..." node scripts/migrate-savings-goals-to-goals.js --apply
 *
 * Without --apply it only reports what it would do.
 */

const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const APPLY = process.argv.includes('--apply');

function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  if (!MONGODB_URI) {
    console.error('Falta la variable de entorno MONGODB_URI');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db();

  const savingsGoals = db.collection('savingsgoals');
  const goalAllocations = db.collection('goalallocations');
  const holdings = db.collection('holdings');
  const wealthEvents = db.collection('wealthevents');
  const goals = db.collection('goals');
  const goalHoldingSelections = db.collection('goal_holding_selections');
  const goalCheckpoints = db.collection('goal_checkpoints');

  const pending = await savingsGoals
    .find({ migratedAt: { $exists: false } })
    .toArray();
  console.log(`Objetivos a migrar: ${pending.length}`);

  if (!pending.length) {
    console.log('Nada para migrar.');
    await client.close();
    return;
  }

  const yearMonth = currentYearMonth();
  let releasedHoldingsCount = 0;
  let releasedTotal = 0;
  let selectionsCreated = 0;

  for (const goal of pending) {
    const allocations = await goalAllocations
      .find({ goalId: goal._id, amount: { $gt: 0 } })
      .toArray();

    console.log(
      `- "${goal.name}" (${goal._id.toString()}): ${allocations.length} tenencia(s) asignada(s)`,
    );

    if (!APPLY) continue;

    const newGoalId = new ObjectId();
    await goals.insertOne({
      _id: newGoalId,
      boardId: goal.boardId,
      createdBy: goal.userId,
      name: goal.name,
      icon: goal.icon,
      targetAmount: goal.targetAmount,
      currency: goal.currency,
      targetDate: goal.targetDate,
      desiredMonthlyContribution: goal.plannedMonthlyContribution,
      priority: goal.priority ?? 5,
      status: goal.status ?? 'active',
      useEstimatedFxForForecast: false,
      legacySavingsGoalId: goal._id,
      createdAt: goal.createdAt ?? new Date(),
      updatedAt: new Date(),
    });

    let totalConsideredValue = 0;
    const valueByHolding = [];

    for (const allocation of allocations) {
      const holding = await holdings.findOne({ _id: allocation.holdingId });
      if (!holding) continue;

      await goalHoldingSelections.insertOne({
        boardId: goal.boardId,
        goalId: newGoalId,
        holdingId: holding._id,
        useEstimatedFx: false,
        selectedBy: goal.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      selectionsCreated++;

      const computable = holding.currency === goal.currency;
      if (computable) totalConsideredValue += holding.currentBalance;
      valueByHolding.push({
        holdingId: holding._id,
        currency: holding.currency,
        value: computable ? holding.currentBalance : 0,
        computable,
      });

      const releaseAmount = Math.min(
        allocation.amount,
        holding.allocatedBalance,
      );
      if (releaseAmount > 0) {
        await holdings.updateOne(
          { _id: holding._id },
          { $inc: { allocatedBalance: -releaseAmount } },
        );
        await wealthEvents.insertOne({
          userId: goal.userId,
          boardId: goal.boardId,
          holdingId: holding._id,
          kind: 'balance_adjustment',
          amount: 0,
          balanceAfter: holding.currentBalance,
          note: `Migración a Objetivos: se liberaron ${releaseAmount} ${holding.currency} antes reservados para "${goal.name}"`,
          occurredAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        releasedHoldingsCount++;
        releasedTotal += releaseAmount;
      }

      await goalAllocations.updateOne(
        { _id: allocation._id },
        { $set: { migratedAt: new Date(), migratedToGoalId: newGoalId } },
      );
    }

    await goalCheckpoints.insertOne({
      boardId: goal.boardId,
      goalId: newGoalId,
      yearMonth,
      totalConsideredValue,
      valueByHolding,
      isBaseline: true,
      capturedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await savingsGoals.updateOne(
      { _id: goal._id },
      { $set: { migratedAt: new Date(), migratedToGoalId: newGoalId } },
    );
  }

  if (!APPLY) {
    console.log(
      'Dry-run: no se modificó nada. Corré con --apply para aplicar.',
    );
  } else {
    console.log(
      `Migrados ${pending.length} objetivo(s), ${selectionsCreated} selección(es) de tenencia creadas, ` +
        `${releasedHoldingsCount} liberación(es) de saldo reservado por un total de ${releasedTotal} (en la moneda de cada tenencia).`,
    );
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
