import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Isolated headless QA with synthetic local fixtures; never operates the user's tab.
const origin = process.env.PIXELFRAME_URL || 'http://localhost:5173';
const fixtureDirectory = process.env.PIXELFRAME_FIXTURES || '/private/tmp/pixelframe-test-fixtures';
const outputDirectory = process.env.PIXELFRAME_TEST_OUTPUT || '/private/tmp/pixelframe-browser-results';
await mkdir(outputDirectory, { recursive: true });
const sizes = process.env.PIXELFRAME_RESPONSIVE_SIZES
  ? process.env.PIXELFRAME_RESPONSIVE_SIZES.split(',').map(value => value.split('x').map(Number))
  : [[320, 568], [390, 844], [768, 1024], [1024, 768], [1440, 900], [844, 390]];
const browser = await chromium.launch({
  executablePath: process.env.PIXELFRAME_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const errors = [];
const results = [];

async function assertNoOverflow(page, description) {
  await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth),
    { message: `${description}: horizontal page overflow` }).toBeLessThanOrEqual(1);
}

async function assertReachable(page, locator, description) {
  await expect(locator, description).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  const rect = await locator.boundingBox();
  const screen = page.viewportSize();
  assert.ok(rect && rect.width > 0 && rect.height > 0 && rect.x >= -1 && rect.y >= -1
    && rect.x + rect.width <= screen.width + 1 && rect.y + rect.height <= screen.height + 1,
  `${description}: not fully reachable: ${JSON.stringify(rect)} at ${screen.width}×${screen.height}`);
}

async function frameState(page) {
  return page.locator('.video-canvas').evaluate(element => {
    const bytes = element.getContext('2d').getImageData(0, 0, element.width, element.height).data;
    let hash = 2166136261;
    for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 16777619);
    return { width: element.width, height: element.height, pixels: hash >>> 0 };
  });
}

async function assertFit(page, expectedDimensions) {
  await page.getByRole('button', { name: 'Ajustar video al visor', exact: true }).click();
  await expect.poll(async () => {
    const [view, frame] = await Promise.all([
      page.locator('.video-viewport').boundingBox(), page.locator('.video-canvas').boundingBox(),
    ]);
    return frame.width > 0 && frame.height > 0 && frame.x >= view.x - 1 && frame.y >= view.y - 1
      && frame.x + frame.width <= view.x + view.width + 1 && frame.y + frame.height <= view.y + view.height + 1;
  }).toBe(true);
  const native = await page.locator('.video-canvas').evaluate(element => [element.width, element.height]);
  assert.deepEqual(native, expectedDimensions, 'Fitting must preserve native canvas resolution.');
  const frame = await page.locator('.video-canvas').boundingBox();
  assert.ok(Math.abs(frame.width / frame.height - native[0] / native[1]) < .001, 'Fitting must preserve aspect ratio.');
  return Math.round(frame.height);
}

async function dropdown(page, name) {
  const trigger = page.getByRole('combobox', { name, exact: true });
  await assertReachable(page, trigger, name);
  await trigger.click();
  const list = page.getByRole('listbox');
  await expect(list).toBeVisible();
  await assertReachable(page, list, `${name} options`);
  assert.match(await list.evaluate(element => getComputedStyle(element).animationName), /pf-dropdown-enter/);
  await page.keyboard.press('Escape');
  await expect(list).not.toBeVisible();
  await expect(trigger).toBeFocused();
}

async function help(page, screenshotName) {
  const trigger = page.getByRole('button', { name: 'Atajos y ayuda', exact: true });
  await trigger.click();
  const dialog = page.locator('.help-dialog');
  await expect(dialog).toHaveAttribute('data-state', 'open');
  await assertReachable(page, dialog, 'Help dialog');
  const close = page.getByRole('button', { name: 'Cerrar ayuda', exact: true });
  await assertReachable(page, close, 'Help close');
  const scroll = dialog.locator('.modal-scroll');
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await assertReachable(page, close, 'Help close after scrolling contents');
  await page.screenshot({ path: join(outputDirectory, `${screenshotName}-help.png`) });
  await close.click();
  await expect(dialog).toHaveAttribute('data-state', 'closed');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog).toHaveAttribute('data-state', 'open');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
}

async function preview(page, screenshotName) {
  const trigger = page.getByRole('button', { name: 'Previsualizar captura 1', exact: true });
  await trigger.click();
  const dialog = page.locator('.preview-dialog');
  await expect(dialog).toHaveAttribute('data-state', 'open');
  assert.equal(await dialog.evaluate(element => getComputedStyle(element).padding), '0px', 'Preview shell must use only its header, content and footer padding.');
  await assertReachable(page, dialog, 'Capture preview');
  await assertReachable(page, page.getByRole('button', { name: 'Cerrar previsualización', exact: true }), 'Preview close');
  await assertReachable(page, dialog.getByRole('button', { name: 'Descargar', exact: true }), 'Preview download');
  const image = dialog.locator('img');
  await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
  await assertReachable(page, image, 'Preview image');
  await page.screenshot({ path: join(outputDirectory, `${screenshotName}-preview.png`) });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
}

async function verifyMotion(reducedMotion) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`${reducedMotion}: ${error.message}`));
  await page.goto(origin);
  await page.evaluate(() => {
    window.__responsiveAnimations = [];
    document.addEventListener('animationend', event => window.__responsiveAnimations.push(event.animationName), true);
  });
  const trigger = page.getByRole('combobox', { name: 'Layout del espacio de trabajo', exact: true });
  await trigger.click();
  const list = page.getByRole('listbox');
  await expect(list).toBeVisible();
  if (reducedMotion === 'reduce') {
    assert.equal(await list.evaluate(element => getComputedStyle(element).animationName), 'none');
  } else {
    await expect.poll(() => page.evaluate(() => window.__responsiveAnimations.includes('pf-dropdown-enter'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(list).not.toBeVisible();
  await expect(trigger).toBeFocused();
  if (reducedMotion !== 'reduce') {
    await expect.poll(() => page.evaluate(() => window.__responsiveAnimations.includes('pf-dropdown-exit'))).toBe(true);
  }

  const helpTrigger = page.getByRole('button', { name: 'Atajos y ayuda', exact: true });
  await helpTrigger.click();
  const dialog = page.locator('.help-dialog');
  await expect(dialog).toHaveAttribute('data-state', 'open');
  assert.equal(await dialog.evaluate(element => getComputedStyle(element).padding), '0px', 'Legacy dialog padding must not override the animated shell.');
  if (reducedMotion === 'reduce') {
    assert.equal(await dialog.evaluate(element => getComputedStyle(element).animationName), 'none');
    assert.equal(await dialog.evaluate(element => getComputedStyle(element, '::backdrop').animationName), 'none');
  } else {
    await expect.poll(() => page.evaluate(() => window.__responsiveAnimations.includes('modal-enter'))).toBe(true);
  }
  await page.getByRole('button', { name: 'Cerrar ayuda', exact: true }).click();
  await expect(dialog).toHaveAttribute('data-state', 'closed');
  if (reducedMotion !== 'reduce') {
    assert.equal(await dialog.evaluate(element => getComputedStyle(element).animationName), 'modal-exit');
  }
  await expect(dialog).not.toBeVisible();
  await expect(helpTrigger).toBeFocused();
  await trigger.click();
  await expect(list).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(list).not.toBeVisible();
  await expect(trigger).toBeFocused();
  console.log(`PASS ${reducedMotion}: dropdown and modal motion, closing, focus restoration, unblocked page.`);
  await context.close();
}

try {
  for (const [width, height] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width <= 700 || height <= 600 });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${width}×${height}: ${error.message}`));
    const prefix = `responsive-${width}x${height}`;
    await page.goto(origin);
    await expect(page.getByRole('combobox', { name: 'Layout del espacio de trabajo' })).toBeVisible();
    await assertNoOverflow(page, `${prefix} empty`);
    await dropdown(page, 'Layout del espacio de trabajo');
    await help(page, prefix);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: join(outputDirectory, `${prefix}-empty.png`), fullPage: true });

    const displayHeights = {};
    for (const [shape, name, dimensions] of [
      ['landscape', 'bframes-2997.mp4', [640, 360]],
      ['portrait', 'portrait-720.mp4', [720, 1280]],
    ]) {
      await page.locator('input[type=file]').setInputFiles(join(fixtureDirectory, name));
      await expect(page.locator('.capture-button')).toBeEnabled({ timeout: 60000 });
      await expect(page.locator('.workspace')).toHaveAttribute('data-layout', shape);
      displayHeights[shape] = await assertFit(page, dimensions);
      const before = await frameState(page);
      const time = await page.getByRole('textbox', { name: 'Código de tiempo SMPTE' }).inputValue();
      await page.locator('.video-canvas').evaluate(element => { window.__responsiveCanvas = element; });
      for (const name of ['Fotograma anterior (←)', 'Fotograma siguiente (→)', 'Reproducir (Espacio)', 'Ajustar video al visor', 'Pantalla completa']) {
        await assertReachable(page, page.getByRole('button', { name, exact: true }), name);
      }
      await assertReachable(page, page.locator('.capture-button'), 'Capture button');
      await dropdown(page, 'Zoom del visor');
      await page.getByRole('tab', { name: 'Por rango', exact: true }).click();
      await dropdown(page, 'Extraer');
      await assertReachable(page, page.getByRole('button', { name: 'Extraer rango', exact: true }), 'Extract range');
      await assertNoOverflow(page, `${prefix} ${shape} range settings`);
      await page.getByRole('tab', { name: 'Fotograma', exact: true }).click();
      await page.locator('.capture-button').click();
      await expect(page.locator('.capture-card')).toHaveCount(1);
      await assertReachable(page, page.getByRole('button', { name: 'Descargar ZIP', exact: true }), 'Export ZIP');
      await assertReachable(page, page.getByRole('button', { name: 'Descargar fotograma', exact: true }), 'Download native frame');
      await preview(page, `${prefix}-${shape}`);
      await assertNoOverflow(page, `${prefix} ${shape}`);
      assert.deepEqual(await frameState(page), before, 'UI interaction must preserve pixels and native resolution.');
      assert.equal(await page.getByRole('textbox', { name: 'Código de tiempo SMPTE' }).inputValue(), time, 'UI interaction must preserve frame time.');
      assert.equal(await page.locator('.video-canvas').evaluate(element => element === window.__responsiveCanvas), true, 'UI interaction must keep canvas mounted.');
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: join(outputDirectory, `${prefix}-${shape}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Vaciar', exact: true }).click();
      await expect(page.locator('.capture-card')).toHaveCount(0);
    }
    if (width === 844 && height === 390) {
      const beforeRotation = await frameState(page);
      for (const next of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(next);
        await assertFit(page, [720, 1280]);
        await assertNoOverflow(page, `Resize to ${next.width}×${next.height}`);
        assert.deepEqual(await frameState(page), beforeRotation, 'Rotating and resizing must preserve native pixels.');
        assert.equal(await page.locator('.video-canvas').evaluate(element => element === window.__responsiveCanvas), true,
          'Rotating and resizing must keep canvas mounted.');
      }
    }
    results.push({ viewport: `${width}×${height}`, displayedHeight: displayHeights });
    console.log(`PASS ${width}×${height}: empty, landscape, portrait, menus, dialogs, reachable controls, native pixels.`);
    await context.close();
  }
  await verifyMotion('no-preference');
  await verifyMotion('reduce');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', results, outputDirectory }, null, 2));
} finally {
  await browser.close();
}
