import { test, expect } from '@playwright/test';
import { users, trpcMutation, trpcQuery, trpcResult, createTestGroup } from './helpers';

test.use({ viewport: { width: 430, height: 932 } });

test('external payment requires an explicit confirmation; cancellation preserves history and restores debt', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const fixture = await createTestGroup(
    users.alice.email,
    users.alice.password,
    [{ email: users.bob.email, password: users.bob.password }],
    'Payment confirmation test',
  );
  const aliceId = fixture.memberIds[users.alice.email]!;
  const bobId = fixture.memberIds[users.bob.email]!;
  const bob = fixture.memberContexts[0]!;
  const ctx = await browser.newContext({
    storageState: await bob.storageState(),
    viewport: { width: 430, height: 932 },
  });
  const page = await ctx.newPage();
  try {
    expect(
      (
        await trpcMutation(fixture.owner, 'auth.updateProfile', {
          paypalMeName: 'AliceTest',
          paypalEmail: '',
          iban: '',
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await trpcMutation(fixture.owner, 'expenses.create', {
          groupId: fixture.groupId,
          title: 'Test dinner',
          amount: 2000,
          currency: 'USD',
          paidById: aliceId,
          splitMode: 'EQUAL',
          shares: [
            { userId: aliceId, amount: 1000 },
            { userId: bobId, amount: 1000 },
          ],
        })
      ).ok(),
    ).toBe(true);
    const payments = async () =>
      (await trpcResult(await trpcQuery(bob, 'settlements.list', { groupId: fixture.groupId }))).items;
    const openPayment = async () => {
      await page.getByRole('button', { name: 'Settle up', exact: true }).click();
      await page.getByRole('button', { name: /Bob Smith.*Alice Johnson/ }).click();
      await expect(page.getByTestId('settle-pay-paypal')).toBeEnabled();
      await page.getByTestId('settle-pay-paypal').click();
      await expect(page.getByTestId('external-payment-confirmation')).toBeVisible();
    };
    // Do not contact the actual payment provider in this local test.
    await page.addInitScript(() => {
      window.open = () => null;
    });
    await page.goto(`/en/groups/${fixture.groupId}`);
    await expect(page.getByTestId('balances-title')).toBeVisible();
    await openPayment();
    await page.waitForTimeout(2500);
    expect(await payments()).toHaveLength(0);
    await page.getByTestId('external-payment-unpaid').click();
    await expect(page.getByTestId('external-payment-confirmation')).toHaveCount(0);
    expect(await payments()).toHaveLength(0);
    await openPayment();
    await page.getByTestId('external-payment-paid').click();
    await expect(page.getByTestId('external-payment-confirmation')).toHaveCount(0);
    const recorded = await payments();
    expect(recorded).toHaveLength(1);
    expect(recorded[0].amount).toBe(1000);
    const history = `/en/groups/${fixture.groupId}/history`;
    await page.goto(history);
    await page.getByRole('button', { name: 'Cancel recorded payment', exact: true }).click();
    await expect(page.getByText(/No money is refunded/)).toBeVisible();
    await page.getByLabel('Reason (optional)').fill('Recorded by mistake');
    await page.getByRole('button', { name: 'Cancel recorded payment now', exact: true }).click();
    await expect(page.getByText('Canceled · excluded from balances')).toBeVisible();
    await expect(page.getByText('Recorded by mistake')).toBeVisible();
    const canceled = await payments();
    expect(canceled).toHaveLength(1);
    expect(canceled[0].canceledAt).not.toBeNull();
    const debts = await trpcResult(await trpcQuery(bob, 'balances.getSimplifiedDebts', { groupId: fixture.groupId }));
    expect(debts.debts).toContainEqual({ from: bobId, to: aliceId, amount: 1000 });
  } finally {
    await ctx.close();
    await trpcMutation(fixture.owner, 'auth.updateProfile', { paypalMeName: '' });
    await fixture.dispose();
  }
});

test('missing payment details can be requested once, with an in-app notification linked to settings', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const fixture = await createTestGroup(
    users.alice.email,
    users.alice.password,
    [{ email: users.bob.email, password: users.bob.password }],
    'Payment data reminder test',
  );
  const bob = fixture.memberContexts[0]!;
  const ctx = await browser.newContext({ storageState: await bob.storageState() });
  const page = await ctx.newPage();
  try {
    const aliceId = fixture.memberIds[users.alice.email]!;
    const bobId = fixture.memberIds[users.bob.email]!;
    expect(
      (
        await trpcMutation(fixture.owner, 'auth.updateProfile', {
          paypalMeName: '',
          paypalEmail: '',
          iban: '',
          venmoUsername: '',
        })
      ).ok(),
    ).toBe(true);
    expect((await trpcMutation(fixture.owner, 'notifications.setEnabled', { enabled: true })).ok()).toBe(true);
    expect(
      (
        await trpcMutation(fixture.owner, 'expenses.create', {
          groupId: fixture.groupId,
          title: 'Reminder dinner',
          amount: 2000,
          currency: 'USD',
          paidById: aliceId,
          splitMode: 'EQUAL',
          shares: [
            { userId: aliceId, amount: 1000 },
            { userId: bobId, amount: 1000 },
          ],
        })
      ).ok(),
    ).toBe(true);
    await page.goto(`/en/groups/${fixture.groupId}`);
    await page.getByRole('button', { name: 'Settle up', exact: true }).click();
    await page.getByRole('button', { name: /Bob Smith.*Alice Johnson/ }).click();
    await expect(page.getByTestId('settle-pay-paypal')).toBeDisabled();
    await expect(page.getByTestId('settle-pay-bank')).toBeDisabled();
    await page.getByTestId('request-payment-details').click();
    await expect(page.getByTestId('request-payment-details')).toHaveText('Request saved');
    await expect(page.getByTestId('request-payment-details')).toBeDisabled();
    const notices = await trpcResult(await trpcQuery(fixture.owner, 'notifications.list', undefined));
    expect(
      notices.items.filter(
        (n: { type: string; groupId: string }) => n.type === 'PAYMENT_DETAILS_REQUEST' && n.groupId === fixture.groupId,
      ),
    ).toHaveLength(1);
    const again = await trpcMutation(bob, 'notifications.requestPaymentDetails', {
      groupId: fixture.groupId,
      userId: aliceId,
    });
    expect(again.ok()).toBe(false);
    expect((await again.json()).error.data.json.code).toBe('TOO_MANY_REQUESTS');
  } finally {
    await ctx.close();
    await fixture.dispose();
  }
});
