import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { selectOption } from './select-option.mjs';

// Run generate-fixtures.mjs and generate-layout-fixtures.mjs first, then start Vite.
// This launches an isolated headless Chrome session and does not use the user's browser.
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
const layout = page.getByRole('combobox', { name: 'Layout del espacio de trabajo' });
const workspace = page.locator('.workspace');
const viewport = page.locator('.video-viewport');
const canvas = page.locator('.video-canvas');
const inspector = page.locator('#extraction-panel');
const tray = page.locator('#capture-tray');
const timecode = page.getByRole('textbox', { name: 'Código de tiempo SMPTE' });
const zoom = page.getByRole('combobox', { name: 'Zoom del visor' });

async function ready() {
  await expect(page.locator('.capture-button')).toBeEnabled({ timeout: 60000 });
}

async function open(name) {
  await page.locator('input[type=file]').setInputFiles(join(fixtureDirectory, name));
  await ready();
}

async function choose(mode, resolved = mode) {
  await selectOption(page, layout, { auto: /^Automático/, landscape: 'Horizontal', portrait: 'Vertical', focus: 'Visor grande' }[mode]);
  await expect(workspace).toHaveAttribute('data-layout-mode', mode);
  await expect(workspace).toHaveAttribute('data-layout', resolved);
  // Wait for the advertised layout transition before comparing final geometry.
  await page.waitForTimeout(400);
}

async function fit() {
  await page.getByRole('button', { name: 'Ajustar video al visor', exact: true }).click();
  await expect(zoom).toContainText('Ajustar');
  await expect.poll(async () => {
    const [view, frame] = await Promise.all([viewport.boundingBox(), canvas.boundingBox()]);
    return frame.x >= view.x - 1 && frame.y >= view.y - 1
      && frame.x + frame.width <= view.x + view.width + 1
      && frame.y + frame.height <= view.y + view.height + 1;
  }).toBe(true);
}

async function assertOnscreen(locator) {
  await expect(locator).toBeVisible();
  const rect = await locator.boundingBox();
  const screen = page.viewportSize();
  assert.ok(rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= screen.width + 1
    && rect.y + rect.height <= screen.height + 1, `Control is outside the viewport: ${JSON.stringify(rect)}`);
}

async function frameState() {
  return { timecode: await timecode.inputValue(), image: await canvas.evaluate(element => element.toDataURL()),
    dimensions: await canvas.evaluate(element => [element.width, element.height]) };
}

async function resize(name, dx, dy) {
  const separator = page.getByRole('separator', { name });
  const initial = Number(await separator.getAttribute('aria-valuenow'));
  const rect = await separator.boundingBox();
  const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + dx, point.y + dy, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(initial + 15);
}

try {
  await page.goto(origin);
  await expect(layout).toContainText('Automático');
  await expect(workspace).toHaveAttribute('data-layout', 'landscape');
  await open('bframes-2997.mp4');
  await expect(workspace).toHaveAttribute('data-layout', 'landscape');
  await open('square-720.mp4');
  await expect(workspace).toHaveAttribute('data-layout', 'landscape');
  await fit();
  const square = await canvas.boundingBox();
  assert.ok(Math.abs(square.width / square.height - 1) < 0.001);

  await open('portrait-720.mp4');
  await expect(workspace).toHaveAttribute('data-layout', 'portrait');
  await fit();
  await choose('landscape');
  await fit();
  const landscapeHeight = (await canvas.boundingBox()).height;
  await page.screenshot({ path: join(outputDirectory, 'layout-portrait-landscape.png'), fullPage: true });
  await choose('portrait');
  await fit();
  const portraitHeight = (await canvas.boundingBox()).height;
  assert.ok(portraitHeight > landscapeHeight + 100,
    `Portrait should gain over 100px of displayed height: ${landscapeHeight} → ${portraitHeight}`);
  const [editorBox, inspectorBox, trayBox] = await Promise.all([
    page.locator('.editor').boundingBox(), inspector.boundingBox(), tray.boundingBox(),
  ]);
  assert.ok(trayBox.x >= editorBox.x + editorBox.width - 2, 'Portrait tray must share the right sidebar.');
  assert.ok(trayBox.y >= inspectorBox.y + inspectorBox.height - 2, 'Portrait tray must be under extraction settings.');
  assert.ok(editorBox.y + editorBox.height >= trayBox.y + trayBox.height - 2, 'Portrait editor must span the full work area.');
  await assertOnscreen(page.getByRole('button', { name: /Descargar ZIP/ }));
  await assertOnscreen(page.getByRole('button', { name: 'Vaciar', exact: true }));

  await timecode.fill('00:00:01:00');
  await timecode.press('Enter');
  await expect(timecode).toHaveValue('00:00:01:00');
  await ready();
  await page.locator('.capture-button').click();
  await expect(page.locator('.capture-card')).toHaveCount(1);
  const frame = await frameState();
  const captureLabel = await page.locator('.capture-card').innerText();
  for (const mode of ['landscape', 'portrait', 'focus', 'auto']) {
    await choose(mode, mode === 'auto' ? 'portrait' : mode);
    assert.deepEqual(await frameState(), frame, `Layout ${mode} must preserve native pixels and frame time.`);
    await expect(page.locator('.capture-card')).toHaveCount(1);
    assert.equal(await page.locator('.capture-card').innerText(), captureLabel);
  }

  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar fotograma', exact: true }).click();
  const download = await pendingDownload;
  const pngPath = join(outputDirectory, 'layout-portrait-native.png');
  await download.saveAs(pngPath);
  const png = await readFile(pngPath);
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [720, 1280]);

  await choose('focus');
  await expect(inspector).toHaveAttribute('aria-hidden', 'true');
  await expect(tray).toHaveAttribute('aria-hidden', 'true');
  const hiddenInspector = await inspector.boundingBox();
  const hiddenTray = await tray.boundingBox();
  assert.ok(!hiddenInspector || hiddenInspector.width < 1 || hiddenInspector.height < 1);
  assert.ok(!hiddenTray || hiddenTray.width < 1 || hiddenTray.height < 1);
  await page.getByRole('button', { name: 'Mostrar panel de extracción', exact: true }).click();
  await expect(inspector).toHaveAttribute('aria-hidden', 'false');
  await choose('portrait');
  if (await tray.getAttribute('aria-hidden') === 'true') {
    await page.getByRole('button', { name: 'Mostrar bandeja de capturas', exact: true }).click();
  }
  await page.waitForTimeout(400);
  await resize('Redimensionar panel de extracción', -50, 0);
  await resize('Redimensionar bandeja de capturas', 0, -40);
  await page.getByRole('separator', { name: 'Redimensionar bandeja de capturas' }).focus();
  const traySize = Number(await page.getByRole('separator', { name: 'Redimensionar bandeja de capturas' }).getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('separator', { name: 'Redimensionar bandeja de capturas' })).toHaveAttribute('aria-valuenow', String(traySize - 10));
  for (const [panel, label] of [[inspector, 'panel de extracción'], [tray, 'bandeja de capturas']]) {
    await page.getByRole('button', { name: `Ocultar ${label}`, exact: true }).click();
    await expect(panel).toHaveAttribute('aria-hidden', 'true');
    await page.getByRole('button', { name: `Mostrar ${label}`, exact: true }).click();
    await expect(panel).toHaveAttribute('aria-hidden', 'false');
  }
  await fit();
  await page.screenshot({ path: join(outputDirectory, 'layout-portrait-desktop.png'), fullPage: true });

  // An explicit choice persists across a reload and overrides newly opened media.
  await choose('landscape');
  await page.reload();
  await expect(layout).toContainText('Horizontal');
  await open('portrait-720.mp4');
  await expect(workspace).toHaveAttribute('data-layout', 'landscape');
  await choose('auto', 'portrait');
  await page.reload();
  await expect(layout).toContainText('Automático');
  await open('portrait-720.mp4');
  await expect(workspace).toHaveAttribute('data-layout', 'portrait');

  // At phone widths, the fitted portrait is complete, undistorted, and large enough to inspect.
  await page.setViewportSize({ width: 390, height: 844 });
  await fit();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const mobileFrame = await canvas.boundingBox();
  assert.ok(Math.abs(mobileFrame.width / mobileFrame.height - 9 / 16) < 0.001);
  assert.ok(mobileFrame.height > 350, `Portrait mobile preview should be legible; got ${mobileFrame.height}px.`);
  await assertOnscreen(canvas);
  await assertOnscreen(layout);
  await page.screenshot({ path: join(outputDirectory, 'layout-portrait-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', checks: ['automatic landscape / square / portrait',
    'portrait gains display height', 'right sidebar tray controls', 'unchanged frame pixels and captures',
    'native portrait PNG', 'focus and panel restoration', 'portrait mouse / keyboard resize and hide',
    'persistent override and auto mode', 'unclipped mobile portrait and no overflow'],
    displayedHeight: { landscape: landscapeHeight, portrait: portraitHeight, mobile: mobileFrame.height }, outputDirectory }, null, 2));
} finally {
  await browser.close();
}
