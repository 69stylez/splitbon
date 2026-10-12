import { beforeEach, describe, expect, test, vi } from 'vitest';
import { computeBalances } from '../../lib/balance-calculator';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/server/auth', () => ({ auth: vi.fn() }));
vi.mock('@/server/db', () => ({ db: {} }));
vi.mock('../../lib/notifications', () => ({ money: vi.fn(), sendNotifications: vi.fn() }));
vi.mock('../../lib/exchange-rates', () => ({ getExchangeRate: vi.fn(), convertCents: vi.fn() }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import { settlementsRouter } from './settlements';
import { balancesRouter } from './balances';
import { activityRouter } from './activity';

const payment = {
  id: 'payment',
  groupId: 'group',
  fromId: 'payer',
  toId: 'recipient',
  amount: 1000,
  currency: 'EUR',
  baseCurrencyAmount: 1200,
  canceledAt: null as Date | null,
};
const db = {
  user: { findUnique: vi.fn() },
  groupMember: { findUnique: vi.fn() },
  settlement: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  activityLog: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  expense: { findMany: vi.fn() },
  group: { findMany: vi.fn() },
  $transaction: vi.fn(),
};
function context(userId = 'payer', authenticated = true) {
  return { db, session: authenticated ? { user: { id: userId } } : null, headers: new Headers(), impersonating: null };
}
function caller(userId = 'payer', authenticated = true) {
  return settlementsRouter.createCaller(
    context(userId, authenticated) as unknown as Parameters<typeof settlementsRouter.createCaller>[0],
  );
}
const input = { groupId: 'group', settlementId: 'payment', reason: ' Wrong amount ' };

beforeEach(() => {
  vi.resetAllMocks();
  payment.canceledAt = null;
  db.user.findUnique.mockResolvedValue({ suspendedAt: null });
  db.groupMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
  db.settlement.findFirst.mockImplementation(async ({ where }) =>
    where.groupId === payment.groupId ? { ...payment } : null,
  );
  db.activityLog.findFirst.mockResolvedValue(null);
  db.activityLog.create.mockResolvedValue({ id: 'audit' });
  db.settlement.updateMany.mockImplementation(async ({ data }) => {
    if (payment.canceledAt) return { count: 0 };
    payment.canceledAt = data.canceledAt;
    return { count: 1 };
  });
  db.$transaction.mockImplementation(async (fn) => {
    const previous = payment.canceledAt;
    try {
      return await fn(db);
    } catch (error) {
      payment.canceledAt = previous;
      throw error;
    }
  });
});

describe('settlements.cancel', () => {
  test.each(['payer', 'recipient'])(
    'allows payment party %s, preserves payment and records an audit',
    async (userId) => {
      expect(await caller(userId).cancel(input)).toEqual({ id: 'payment', canceled: true });
      expect(payment.canceledAt).toBeInstanceOf(Date);
      expect(payment.amount).toBe(1000);
      expect(payment.baseCurrencyAmount).toBe(1200);
      expect(db.settlement.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment', groupId: 'group', canceledAt: null },
        data: { canceledAt: expect.any(Date) },
      });
      expect(db.activityLog.create).toHaveBeenCalledWith({
        data: {
          groupId: 'group',
          userId,
          type: 'SETTLEMENT_CANCELED',
          entityId: 'payment',
          metadata: {
            fromId: 'payer',
            toId: 'recipient',
            amount: 1000,
            currency: 'EUR',
            baseCurrencyAmount: 1200,
            reason: 'Wrong amount',
          },
        },
      });
    },
  );
  test.each(['ADMIN', 'OWNER'])('allows group %s', async (role) => {
    db.groupMember.findUnique.mockResolvedValue({ role });
    await expect(caller('admin').cancel(input)).resolves.toMatchObject({ canceled: true });
  });
  test('allows the recording creator, even after their admin role was removed', async () => {
    db.activityLog.findFirst.mockResolvedValue({ id: 'creation' });
    await expect(caller('creator').cancel(input)).resolves.toMatchObject({ canceled: true });
    expect(db.activityLog.findFirst).toHaveBeenCalledWith({
      where: { groupId: 'group', entityId: 'payment', type: 'SETTLEMENT_CREATED', userId: 'creator' },
      select: { id: true },
    });
  });
  test('forbids an unrelated member before any write', async () => {
    await expect(caller('other').cancel(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(db.settlement.updateMany).not.toHaveBeenCalled();
    expect(db.activityLog.create).not.toHaveBeenCalled();
  });
  test('requires authentication', async () => {
    await expect(caller('payer', false).cancel(input)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  test('requires group membership', async () => {
    db.groupMember.findUnique.mockResolvedValue(null);
    await expect(caller().cancel(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  test('does not cancel a payment through a different group', async () => {
    await expect(caller().cancel({ ...input, groupId: 'other-group' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.settlement.updateMany).not.toHaveBeenCalled();
  });
  test('retries are idempotent and preserve original cancellation date', async () => {
    await caller().cancel(input);
    const date = payment.canceledAt;
    await caller().cancel(input);
    expect(payment.canceledAt).toBe(date);
    expect(db.activityLog.create).toHaveBeenCalledTimes(1);
  });
  test('concurrent cancellations use an atomic condition and create one audit', async () => {
    await Promise.all([caller().cancel(input), caller('recipient').cancel(input)]);
    expect(db.activityLog.create).toHaveBeenCalledTimes(1);
  });
  test('audit failure rolls back cancellation in the same transaction', async () => {
    db.activityLog.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(caller().cancel(input)).rejects.toThrow('audit unavailable');
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(payment.canceledAt).toBeNull();
  });
  test('limits correction reasons', async () => {
    await expect(caller().cancel({ ...input, reason: 'a'.repeat(501) })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('canceled settlements and balances/history', () => {
  test('restores debt including foreign-currency amount, without counting cancellation twice', () => {
    const expenses = [{ paidById: 'recipient', amount: 1200, shares: [{ userId: 'payer', amount: 1200 }] }];
    expect(computeBalances(expenses, [payment]).every((balance) => balance.net === 0)).toBe(true);
    const canceled = { ...payment, canceledAt: new Date() };
    expect(computeBalances(expenses, [canceled])).toEqual(computeBalances(expenses, []));
    expect(computeBalances([], [canceled])).toEqual([]);
  });
  test('group, simplified, dashboard and overall queries all load cancellation status', async () => {
    db.expense.findMany.mockResolvedValue([]);
    db.settlement.findMany.mockResolvedValue([{ ...payment, canceledAt: new Date() }]);
    db.group.findMany.mockResolvedValue([
      {
        id: 'group',
        name: 'Group',
        currency: 'EUR',
        expenses: [],
        settlements: [{ ...payment, canceledAt: new Date() }],
        members: [],
      },
    ]);
    const api = balancesRouter.createCaller(context() as unknown as Parameters<typeof balancesRouter.createCaller>[0]);
    expect(await api.getGroupBalances({ groupId: 'group' })).toEqual({ balances: [] });
    expect(await api.getSimplifiedDebts({ groupId: 'group' })).toEqual({ debts: [] });
    expect(await api.getOverallDebts()).toEqual({ owedToYou: [], youOwe: [] });
    expect(await api.getDashboard()).toMatchObject({ totalOwed: 0, totalOwing: 0 });
    for (const [query] of db.settlement.findMany.mock.calls) expect(query.select.canceledAt).toBe(true);
    for (const [query] of db.group.findMany.mock.calls) expect(query.select.settlements.select.canceledAt).toBe(true);
  });
  test('list retains canceled payment history', async () => {
    db.settlement.findMany.mockResolvedValue([{ ...payment, canceledAt: new Date() }]);
    const result = await caller().list({ groupId: 'group' });
    expect(result.items[0]?.canceledAt).toBeInstanceOf(Date);
    expect(db.settlement.findMany.mock.calls[0]?.[0].where).toEqual({ groupId: 'group' });
  });
  test.each([
    ['payer', true],
    ['recipient', true],
    ['creator', true],
    ['other', false],
  ])('history cancel permission for %s is %s', async (userId, canCancel) => {
    db.activityLog.findMany.mockResolvedValue([
      { id: 'created', userId: 'creator', type: 'SETTLEMENT_CREATED', entityId: 'payment', user: null },
    ]);
    db.settlement.findMany.mockResolvedValue([payment]);
    const api = activityRouter.createCaller(
      context(userId) as unknown as Parameters<typeof activityRouter.createCaller>[0],
    );
    const result = await api.getGroupActivity({ groupId: 'group' });
    expect(result.items[0]?.settlement?.canCancel).toBe(canCancel);
  });
  test('history exposes canceled status without another cancel action', async () => {
    db.activityLog.findMany.mockResolvedValue([
      { id: 'created', userId: 'payer', type: 'SETTLEMENT_CREATED', entityId: 'payment', user: null },
    ]);
    db.settlement.findMany.mockResolvedValue([{ ...payment, canceledAt: new Date() }]);
    const api = activityRouter.createCaller(context() as unknown as Parameters<typeof activityRouter.createCaller>[0]);
    const result = await api.getGroupActivity({ groupId: 'group' });
    expect(result.items[0]?.settlement).toMatchObject({ canceledAt: expect.any(Date), canCancel: false });
  });
});
