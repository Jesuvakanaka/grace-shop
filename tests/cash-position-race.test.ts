import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import prisma from '../src/lib/db';
import { getOrCreateCashPosition } from '../src/lib/cash';
import { createExpense } from '../src/lib/expenses';

// Dates far from "today" so this file never collides with rows other tests use.
const RACE_DAY = new Date(2099, 0, 2, 12, 0, 0);
const RACE_DAY_START = new Date(2099, 0, 2);

describe('Cash position: concurrent get-or-create for a new day', () => {
  beforeEach(async () => {
    await prisma.cashPosition.deleteMany({ where: { cashDate: { gte: new Date(2099, 0, 1) } } });
    await prisma.expense.deleteMany({ where: { expenseDate: { gte: new Date(2099, 0, 1) } } });
    // Previous day closed with 500 counted, so the new day must open with 500.
    await prisma.cashPosition.create({
      data: { cashDate: new Date(2099, 0, 1), openingCash: 0, expectedClosingCash: 480, actualCountedCash: 500 },
    });
  });

  after(async () => {
    await prisma.cashPosition.deleteMany({ where: { cashDate: { gte: new Date(2099, 0, 1) } } });
    await prisma.expense.deleteMany({ where: { expenseDate: { gte: new Date(2099, 0, 1) } } });
  });

  test('5 concurrent getOrCreateCashPosition calls all succeed and share one row', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => getOrCreateCashPosition(RACE_DAY)),
    );
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.deepStrictEqual(rejected.map((r) => String((r as PromiseRejectedResult).reason?.code ?? r)), []);

    const ids = new Set(results.map((r) => (r as PromiseFulfilledResult<{ id: number }>).value.id));
    assert.strictEqual(ids.size, 1);

    const rows = await prisma.cashPosition.findMany({ where: { cashDate: RACE_DAY_START } });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].openingCash, 500);
    assert.strictEqual(rows[0].expectedClosingCash, 500);
  });

  test('5 concurrent cash expenses on a new day all succeed and every amount is counted', async () => {
    const amounts = [10, 20, 30, 40, 50];
    const results = await Promise.allSettled(
      amounts.map((amount) =>
        createExpense({ expenseDate: RACE_DAY, category: 'Other', description: `race ${amount}`, amount }),
      ),
    );
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.deepStrictEqual(rejected.map((r) => String((r as PromiseRejectedResult).reason?.code ?? r)), []);

    const rows = await prisma.cashPosition.findMany({ where: { cashDate: RACE_DAY_START } });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].openingCash, 500);
    assert.strictEqual(rows[0].expensesPaid, 150);
    assert.strictEqual(rows[0].expectedClosingCash, 350);
  });
});
