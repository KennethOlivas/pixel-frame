import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { selectOption } from './select-option.mjs';

const origin = process.env.PIXELFRAME_URL || 'http://localhost:5173';
const fixtureDirectory = process.env.PIXELFRAME_FIXTURES || '/private/tmp/pixelframe-test-fixtures';
const outputDirectory = process.env.PIXELFRAME_TEST_OUTPUT || '/private/tmp/pixelframe-browser-results';
await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PIXELFRAME_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const zoom = page.getByRole('combobox', { name: 'Zoom del visor' });
const zoomIn = page.getByRole('button', { name: 'Acercar video', exact: true });
const zoomOut = page.getByRole('button', { name: 'Alejar video', exact: true });
const fit = page.getByRole('button', { name: 'Ajustar video al visor', exact: true });
const viewport = page.locator('.video-viewport');
const canvas = page.locator('.video-canvas');
const scale = async () => Number(await viewport.getAttribute('data-zoom-scale'));

async function open(name) {
  await page.locator('input[type=file]').setInputFiles(join(fixtureDirectory, name));
  await expect(page.locator('.capture-button')).toBeEnabled({ timeout: 60000 });
}

async function selectScale(value, width, height) {
  await selectOption(page, zoom, `${value}%`);
  await expect.poll(scale).toBeCloseTo(value / 100, 4);
  await expect.poll(async () => (await canvas.boundingBox()).width).toBeCloseTo(width * value / 100, 0);
  await expect.poll(async () => (await canvas.boundingBox()).height).toBeCloseTo(height * value / 100, 0);
}

async function assertContainedPan() {
  await expect.poll(async () => {
    const [view, frame] = await Promise.all([viewport.boundingBox(), canvas.boundingBox()]);
    return Math.abs(Number(await viewport.getAttribute('data-pan-x'))) <= Math.max(0, (frame.width - view.width) / 2) + 1
      && Math.abs(Number(await viewport.getAttribute('data-pan-y'))) <= Math.max(0, (frame.height - view.height) / 2) + 1
      && (frame.width <= view.width + 1 || (frame.x <= view.x + 1 && frame.x + frame.width >= view.x + view.width - 1))
      && (frame.height <= view.height + 1 || (frame.y <= view.y + 1 && frame.y + frame.height >= view.y + view.height - 1));
  }).toBe(true);
}

async function assertFit() {
  await fit.click();
  await expect(zoom).toContainText('Ajustar');
  await expect.poll(async () => {
    const [view, frame] = await Promise.all([viewport.boundingBox(), canvas.boundingBox()]);
    return frame.width <= view.width + 1 && frame.height <= view.height + 1;
  }).toBe(true);
  assert.equal(Number(await viewport.getAttribute('data-pan-x')), 0);
  assert.equal(Number(await viewport.getAttribute('data-pan-y')), 0);
}

try {
  await page.goto(origin);
  for (const control of [zoom, zoomIn, zoomOut, fit]) await expect(control).toBeDisabled();
  await open('bframes-2997.mp4');
  await assertFit();

  // Dropdown keys stay in the menu: navigating, typeahead, and Escape must not
  // seek/play video, add captures, change zoom, or open the shortcut dialog.
  const timecode = page.getByRole('textbox', { name: 'Código de tiempo SMPTE' });
  const initialTime = await timecode.inputValue();
  const initialScale = await scale();
  await zoom.focus();
  await zoom.press('ArrowRight');
  await zoom.press('Enter');
  await expect(page.getByRole('listbox')).toBeVisible();
  for (const key of ['End', 'ArrowUp', 'Home', 'c', 'l', '+', '?']) await page.keyboard.press(key);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(zoom).toBeFocused();
  await expect(zoom).toHaveAttribute('aria-expanded', 'false');
  await expect(timecode).toHaveValue(initialTime);
  await expect.poll(scale).toBeCloseTo(initialScale, 4);
  await expect(page.locator('.capture-card')).toHaveCount(0);
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  // Selection also works with the keyboard alone.
  await zoom.press('Enter');
  await expect(page.getByRole('option', { name: /^Ajustar/ })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('option', { name: '400%', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(zoom).toHaveText('400%');
  await expect.poll(scale).toBeCloseTo(4, 4);
  await expect(timecode).toHaveValue(initialTime);
  await selectScale(200, 640, 360);
  assert.deepEqual(await canvas.evaluate(element => [element.width, element.height]), [640, 360]);

  await zoomIn.click();
  await expect.poll(scale).toBeGreaterThan(2);
  const enlarged = await scale();
  await zoomOut.click();
  await expect.poll(scale).toBeLessThan(enlarged);
  await selectScale(200, 640, 360);

  const view = await viewport.boundingBox();
  const center = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(1435, 995, { steps: 12 });
  await page.mouse.up();
  await assertContainedPan();
  assert.ok(Math.abs(Number(await viewport.getAttribute('data-pan-x'))) > 0, 'Dragging a zoomed frame must pan it.');
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(5, 5, { steps: 12 });
  await page.mouse.up();
  await assertContainedPan();

  await assertFit();
  await selectScale(200, 640, 360);
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(50, 50);
  await expect.poll(async () => Math.abs(Number(await viewport.getAttribute('data-pan-x'))) + Math.abs(Number(await viewport.getAttribute('data-pan-y')))).toBeGreaterThan(0);
  await assertContainedPan();

  await page.mouse.move(center.x, center.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -160);
  await page.keyboard.up('Control');
  await expect.poll(scale).toBeGreaterThan(2);
  await assertContainedPan();
  await selectScale(400, 640, 360);
  await expect(zoomIn).toBeDisabled();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -1000);
  await page.keyboard.up('Control');
  await expect.poll(scale).toBeCloseTo(4, 4);
  await selectScale(10, 640, 360);
  await expect(zoomOut).toBeDisabled();

  await selectScale(200, 640, 360);
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar fotograma', exact: true }).click();
  const download = await pendingDownload;
  const pngPath = join(outputDirectory, 'zoom-native-frame.png');
  await download.saveAs(pngPath);
  const png = await readFile(pngPath);
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [640, 360]);
  await page.screenshot({ path: join(outputDirectory, 'zoom-desktop.png'), fullPage: true });
  await assertFit();

  await selectScale(200, 640, 360);
  await open('native-4k.mp4');
  await expect(zoom).toContainText('Ajustar');
  await assertFit();
  await selectScale(100, 3840, 2160);
  assert.deepEqual(await canvas.evaluate(element => [element.width, element.height]), [3840, 2160]);
  await page.setViewportSize({ width: 390, height: 844 });
  await assertContainedPan();
  await assertFit();
  await selectScale(200, 3840, 2160);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(outputDirectory, 'zoom-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: disabled empty controls, dropdown keyboard selection and shortcut isolation, native-relative zoom, zoom buttons and limits, bounded drag and wheel, fit reset, native PNG export, 4K and mobile layout.');
} finally {
  await browser.close();
}
