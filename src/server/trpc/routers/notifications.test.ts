import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/server/auth', () => ({ auth: vi.fn() }));
vi.mock('@/server/db', () => ({ db: {} }));
vi.mock('@/server/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
const { sendNotifications, checkRateLimit, refundRateLimit } = vi.hoisted(() => ({
  sendNotifications: vi.fn(async () => undefined),
  checkRateLimit: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
  refundRateLimit: vi.fn(),
}));
vi.mock('../../lib/notifications', () => ({ sendNotifications, getVapidKeys: vi.fn() }));
vi.mock('../../lib/rate-limit', () => ({ checkRateLimit, refundRateLimit }));
import { notificationsRouter } from './notifications';
import type { TRPCContext } from '../init';

function fixture(
  options: {
    member?: boolean;
    recipient?: boolean;
    recent?: boolean;
    stored?: boolean;
    user?: Record<string, unknown>;
  } = {},
) {
  const db = {
    user: { findUnique: vi.fn(async () => ({ id: 'alice', suspendedAt: null })) },
    groupMember: {
      findUnique: vi.fn(async ({ where }: { where: { userId_groupId: { userId: string } } }) =>
        where.userId_groupId.userId === 'alice'
          ? options.member === false
            ? null
            : { userId: 'alice' }
          : options.recipient === false
            ? null
            : {
                user: {
                  isPlaceholder: false,
                  suspendedAt: null,
                  notifyEnabled: true,
                  paypalEmail: null,
                  paypalMeName: null,
                  iban: null,
                  ...options.user,
                },
              },
      ),
    },
    notification: {
      findFirst: vi
        .fn()
        .mockResolvedValueOnce(options.recent ? { id: 'old' } : null)
        .mockResolvedValueOnce(options.stored === false ? null : { id: 'new' }),
    },
  };
  const caller = notificationsRouter.createCaller({
    db,
    session: { user: { id: 'alice', name: 'Alice' } },
    headers: new Headers(),
    impersonating: null,
  } as unknown as TRPCContext);
  return { db, caller };
}

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
});

describe('payment detail requests', () => {
  it('stores a targeted request only after group membership checks', async () => {
    const { db, caller } = fixture();
    await expect(caller.requestPaymentDetails({ groupId: 'g', userId: 'bob' })).resolves.toEqual({ stored: true });
    expect(sendNotifications).toHaveBeenCalledWith(db, [
      { userId: 'bob', kind: 'PAYMENT_DETAILS_REQUEST', groupId: 'g', entityId: 'alice', vars: { actor: 'Alice' } },
    ]);
    expect(db.notification.findFirst).toHaveBeenCalledTimes(2);
  });
  it('refuses nonmembers, outside recipients, and self reminders', async () => {
    await expect(
      fixture({ member: false }).caller.requestPaymentDetails({ groupId: 'g', userId: 'bob' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      fixture({ recipient: false }).caller.requestPaymentDetails({ groupId: 'g', userId: 'bob' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(fixture().caller.requestPaymentDetails({ groupId: 'g', userId: 'alice' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(sendNotifications).not.toHaveBeenCalled();
  });
  it.each([{ notifyEnabled: false }, { isPlaceholder: true }, { suspendedAt: new Date() }])(
    'honors recipient availability and notification preferences: %j',
    async (user) => {
      await expect(
        fixture({ user }).caller.requestPaymentDetails({ groupId: 'g', userId: 'bob' }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
      expect(sendNotifications).not.toHaveBeenCalled();
    },
  );
  it.each([{ paypalEmail: 'bob@example.com' }, { paypalMeName: 'BobExample' }, { iban: 'DE89370400440532013000' }])(
    'refuses reminders if usable payment details exist: %j',
    async (user) => {
      await expect(
        fixture({ user }).caller.requestPaymentDetails({ groupId: 'g', userId: 'bob' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(sendNotifications).not.toHaveBeenCalled();
    },
  );
  it('enforces persisted cooldown across senders/restarts', async () => {
    await expect(
      fixture({ recent: true }).caller.requestPaymentDetails({ groupId: 'g', userId: 'bob' }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(sendNotifications).not.toHaveBeenCalled();
  });
  it('blocks concurrent requests in the current process', async () => {
    checkRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 1000 });
    await expect(fixture().caller.requestPaymentDetails({ groupId: 'g', userId: 'bob' })).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
    expect(sendNotifications).not.toHaveBeenCalled();
  });
  it('does not claim success when storage failed and allows retry', async () => {
    await expect(
      fixture({ stored: false }).caller.requestPaymentDetails({ groupId: 'g', userId: 'bob' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    expect(refundRateLimit).toHaveBeenCalledWith('payment-details:g:bob');
  });
});
