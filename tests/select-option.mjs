import { expect } from '@playwright/test';

// Exercise the visible, accessible Radix control rather than its hidden form select.
export async function selectOption(page, trigger, label) {
  await trigger.click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.getByRole('option', { name: label, exact: typeof label === 'string' }).click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toContainText(label);
}
