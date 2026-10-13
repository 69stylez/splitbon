import { test, expect } from '@playwright/test';
import { createTestGroup, FAKE_PNG, login, trpcMutation, users } from './helpers';

test.use({ viewport: { width: 390, height: 844 } });

test('receipt image opens and closes inside the app on mobile', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = await createTestGroup(users.alice.email, users.alice.password, [], `Receipt viewer ${Date.now()}`);

  try {
    const upload = await fixture.owner.post('/api/upload', {
      multipart: { file: { name: 'receipt.png', mimeType: 'image/png', buffer: FAKE_PNG } },
    });
    expect(upload.ok()).toBe(true);
    const { receiptId } = await upload.json();

    const processed = await trpcMutation(fixture.owner, 'receipts.processReceipt', {
      receiptId,
      groupId: fixture.groupId,
    });
    expect(processed.ok()).toBe(true);

    await login(page, users.alice.email, users.alice.password);
    await page.goto(`/en/groups/${fixture.groupId}/receipts/${receiptId}/claim`);
    const receiptImage = page.getByTestId('claim-receipt-image');
    await expect(receiptImage).toBeVisible();
    await receiptImage.locator('summary').click();

    await page.getByTestId('receipt-image-open').click();
    await expect(page.getByTestId('receipt-image-viewer')).toBeVisible();
    const closeButton = page.getByTestId('receipt-image-close-icon');
    await expect(closeButton).toBeVisible();
    await expect(closeButton).toBeInViewport();
    await closeButton.click();
    await expect(page.getByTestId('receipt-image-viewer')).toHaveCount(0);
  } finally {
    await fixture.dispose();
  }
});
