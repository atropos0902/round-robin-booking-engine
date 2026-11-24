import { expect, test } from '@playwright/test';

const base = process.env.ENVIRONMENT_URL ?? 'http://localhost:3000';

/**
 * Books a real slot and cancels it. The link is synthetic, so no mail and no calendar entry.
 * Chatham is on a 45 minute offset: a slot shown in the wrong zone fails this check.
 */
test.use({ timezoneId: 'Pacific/Chatham' });

test('a customer can book a slot and cancel it', async ({ page }) => {
  await page.goto(`${base}/release-check`);
  await expect(page.getByLabel('Times shown in')).toHaveValue('Pacific/Chatham');
  const slots = page.locator('[data-slot]');
  await expect(slots.first()).toBeVisible();

  // Not the first slots, they can run out of notice while the page is open.
  const slot = slots.nth(Math.floor(Math.random() * 40) + 20);
  const start = (await slot.getAttribute('data-slot'))!;
  const shown = new Intl.DateTimeFormat('en-GB', { timeZone: 'Pacific/Chatham', hour: '2-digit', minute: '2-digit' });
  await expect(slot).toHaveText(shown.format(new Date(start)));
  await slot.click();

  await page.getByLabel('Your name').fill('Release check');
  await page.getByLabel('Email').fill('release-check@example.test');
  await page.getByRole('button', { name: 'Book the meeting' }).click();

  const status = page.locator('[data-status]');
  await expect(status).toHaveText('Confirmed');
  await page.getByRole('button', { name: 'Cancel the meeting' }).click();
  await expect(status).toHaveText('Cancelled');
});
