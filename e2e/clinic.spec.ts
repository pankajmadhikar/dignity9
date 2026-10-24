import { expect, test } from '@playwright/test';

test('receptionist reaches the live queue', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Enter clinic' }).click();
  await expect(page.getByText('Live queue')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Desk' })).toBeVisible();
});

test('doctor opens today’s board', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'doctor@dignity.test' }).click();
  await page.getByRole('button', { name: 'Enter clinic' }).click();
  await expect(page.getByText('Live queue')).toBeVisible();
  await expect(page.getByText('Waiting')).toBeVisible();
});
