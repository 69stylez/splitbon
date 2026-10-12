import { expect, test, vi } from 'vitest';
vi.mock('@/server/auth', () => ({ auth: vi.fn() }));
vi.mock('@/server/db', () => ({ db: {} }));
vi.mock('@/server/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/lib/receipt-processor', () => ({ processReceiptImage: vi.fn() }));
vi.mock('@/server/ai/registry', () => ({
  getAIProvidersWithFallback: vi.fn(),
  getConfiguredProviderPriority: vi.fn(),
}));
vi.mock('../../lib/notifications', () => ({ money: vi.fn(), sendNotifications: vi.fn(), shareChangeItems: vi.fn() }));
vi.mock('fs/promises', () => ({ unlink: vi.fn(async () => undefined) }));
vi.mock('../../lib/upload-dir', () => ({ resolveUploadPath: vi.fn(() => '/unused/test.png') }));
import { receiptsRouter } from './receipts';
import type { TRPCContext } from '../init';

function fixture({
  role,
  groupId = 'group',
  uploader = 'other',
  saver = 'other',
  expense = false,
}: {
  role?: string | null;
  groupId?: string | null;
  uploader?: string;
  saver?: string;
  expense?: boolean;
} = {}) {
  const db = {
    user: { findUnique: vi.fn(async () => ({ suspendedAt: null })) },
    receipt: {
      findUnique: vi.fn(async () => ({
        id: 'receipt',
        groupId,
        uploadedById: uploader,
        savedById: saver,
        imagePath: 'test.png',
      })),
      delete: vi.fn(async () => ({})),
    },
    groupMember: { findUnique: vi.fn(async () => (role ? { role } : null)) },
    expense: { findUnique: vi.fn(async () => (expense ? { id: 'expense' } : null)) },
    receiptItem: { deleteMany: vi.fn(async () => ({ count: 1 })) },
  };
  const caller = receiptsRouter.createCaller({
    db,
    session: { user: { id: 'alice' } },
    headers: new Headers(),
    impersonating: null,
  } as unknown as TRPCContext);
  return { db, caller };
}

for (const role of ['ADMIN', 'OWNER']) {
  test(`${role} can delete another person's pending receipt in their own group`, async () => {
    const { caller, db } = fixture({ role });
    await expect(caller.deletePending({ receiptId: 'receipt' })).resolves.toEqual({ success: true });
    expect(db.groupMember.findUnique).toHaveBeenCalledWith({
      where: { userId_groupId: { userId: 'alice', groupId: 'group' } },
    });
    expect(db.receipt.delete).toHaveBeenCalledWith({ where: { id: 'receipt' } });
  });
}
for (const role of ['MEMBER', null]) {
  test(`non-owner with role ${role} cannot delete the receipt`, async () => {
    const { caller, db } = fixture({ role });
    await expect(caller.deletePending({ receiptId: 'receipt' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(db.receiptItem.deleteMany).not.toHaveBeenCalled();
    expect(db.receipt.delete).not.toHaveBeenCalled();
  });
}
test('a group-less receipt cannot be deleted through unrelated admin membership', async () => {
  const { caller, db } = fixture({ role: 'ADMIN', groupId: null });
  await expect(caller.deletePending({ receiptId: 'receipt' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(db.groupMember.findUnique).not.toHaveBeenCalled();
  expect(db.receipt.delete).not.toHaveBeenCalled();
});
for (const owner of ['uploader', 'saver'] as const) {
  test(`${owner} keeps permission to delete`, async () => {
    const { caller } = fixture({ [owner]: 'alice' });
    await expect(caller.deletePending({ receiptId: 'receipt' })).resolves.toEqual({ success: true });
  });
}
test('even a group admin cannot delete a receipt linked to an expense', async () => {
  const { caller, db } = fixture({ role: 'ADMIN', expense: true });
  await expect(caller.deletePending({ receiptId: 'receipt' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(db.receiptItem.deleteMany).not.toHaveBeenCalled();
  expect(db.receipt.delete).not.toHaveBeenCalled();
});
