import { expect, test, vi } from 'vitest';
vi.mock('@/server/auth', () => ({ auth: vi.fn() }));
vi.mock('@/server/db', () => ({ db: {} }));
vi.mock('../../lib/notifications', () => ({ money: vi.fn(), sendNotifications: vi.fn(), shareChangeItems: vi.fn() }));
import { expensesRouter } from './expenses';
import type { TRPCContext } from '../init';

test('new expenses store canonical preset IDs while keeping custom categories', async () => {
  const db = {
    user: { findUnique: vi.fn(async () => ({ suspendedAt: null })) },
    group: { findUnique: vi.fn(async () => ({ currency: 'EUR', archivedAt: null })) },
    groupMember: {
      findUnique: vi.fn(async () => ({ role: 'MEMBER' })),
      findFirst: vi.fn(async () => ({ userId: 'alice' })),
      count: vi.fn(async () => 1),
    },
    expense: {
      create: vi.fn(async ({ data }: { data: { category?: string; amount: number } }) => ({
        ...data,
        id: 'expense',
        shares: [],
      })),
    },
    activityLog: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (fn) => fn(db));
  const caller = expensesRouter.createCaller({
    db,
    session: { user: { id: 'alice' } },
    headers: new Headers(),
    impersonating: null,
  } as unknown as TRPCContext);
  for (const [category, expected] of [
    ['Essen', 'food'],
    ['Food', 'food'],
    ['Tauchen', 'Tauchen'],
  ] as const) {
    await caller.create({
      groupId: 'group',
      title: 'Dinner',
      amount: 1000,
      currency: 'EUR',
      paidById: 'alice',
      splitMode: 'EQUAL',
      shares: [{ userId: 'alice', amount: 1000 }],
      category,
    });
    expect(db.expense.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: expected, amount: 1000 }) }),
    );
  }
});

test('existing Food and Essen totals merge without any database write or monetary change', async () => {
  const rows = [
    { category: 'Food', amount: 16121, baseCurrencyAmount: null, paidById: 'alice', shares: [{ amount: 16121 }] },
    { category: 'Essen', amount: 7397, baseCurrencyAmount: null, paidById: 'alice', shares: [{ amount: 7397 }] },
    { category: 'Tauchen', amount: 1200, baseCurrencyAmount: null, paidById: 'alice', shares: [{ amount: 1200 }] },
  ];
  const before = JSON.stringify(rows);
  const db = {
    user: { findUnique: vi.fn(async () => ({ suspendedAt: null })) },
    groupMember: { findUnique: vi.fn(async () => ({ role: 'MEMBER' })) },
    expense: { findMany: vi.fn(async () => rows), update: vi.fn(), updateMany: vi.fn() },
  };
  const caller = expensesRouter.createCaller({
    db,
    session: { user: { id: 'alice' } },
    headers: new Headers(),
    impersonating: null,
  } as unknown as TRPCContext);
  const result = await caller.myTotals({ groupId: 'group' });
  expect(result.categories).toEqual([
    { category: 'food', amount: 23518 },
    { category: 'Tauchen', amount: 1200 },
  ]);
  expect(result).toMatchObject({ paid: 24718, share: 24718, total: 24718, count: 3 });
  expect(JSON.stringify(rows)).toBe(before);
  expect(db.expense.update).not.toHaveBeenCalled();
  expect(db.expense.updateMany).not.toHaveBeenCalled();
});

test('totals distinguish a person’s share from all visible group expenses', async () => {
  const db = {
    user: { findUnique: vi.fn(async () => ({ suspendedAt: null })) },
    groupMember: { findUnique: vi.fn(async () => ({ role: 'MEMBER' })) },
    expense: {
      findMany: vi.fn(async () => [
        {
          category: 'Food',
          amount: 1000,
          baseCurrencyAmount: null,
          paidById: 'alice',
          shares: [
            { userId: 'alice', amount: 400 },
            { userId: 'bob', amount: 600 },
          ],
        },
        {
          category: 'Accommodation',
          amount: 500,
          baseCurrencyAmount: null,
          paidById: 'bob',
          shares: [{ userId: 'bob', amount: 500 }],
        },
      ]),
    },
  };
  const caller = expensesRouter.createCaller({
    db,
    session: { user: { id: 'alice' } },
    headers: new Headers(),
    impersonating: null,
  } as unknown as TRPCContext);

  await expect(caller.myTotals({ groupId: 'group', personId: 'alice' })).resolves.toMatchObject({
    paid: 1000,
    share: 400,
    total: 400,
    count: 1,
    categories: [{ category: 'food', amount: 400 }],
  });
  await expect(caller.myTotals({ groupId: 'group' })).resolves.toMatchObject({
    paid: 1500,
    share: 1500,
    total: 1500,
    count: 2,
    categories: [
      { category: 'food', amount: 1000 },
      { category: 'accommodation', amount: 500 },
    ],
  });
});
