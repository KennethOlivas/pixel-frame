import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { selectOption } from './select-option.mjs';

// Run against the production preview so this also verifies the actual offline bundle.
const origin = process.env.PIXELFRAME_URL || 'http://localhost:4173';
const fixtureDirectory = process.env.PIXELFRAME_FIXTURES || '/private/tmp/pixelframe-test-fixtures';
const outputDirectory = process.env.PIXELFRAME_TEST_OUTPUT || '/private/tmp/pixelframe-browser-results';
await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PIXELFRAME_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
const externalRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(origin).origin) externalRequests.push(request.url());
});
async function open(name) {
  await page.locator('input[type=file]').setInputFiles(join(fixtureDirectory, name));
  await page.waitForFunction(() => !document.querySelector('.capture-button').disabled, { timeout: 60000 });
  await page.locator('body').click({ position: { x: 3, y: 3 } });
}
async function download(action, filename) {
  const pending = page.waitForEvent('download');
  await action();
  const result = await pending;
  const path = join(outputDirectory, filename);
  await result.saveAs(path);
  return { path, name: result.suggestedFilename() };
}
async function timecode(value) {
  await page.waitForFunction(expected => document.querySelector('.timecode-input').value === expected, value);
}
async function ready() { await page.waitForFunction(() => !document.querySelector('.capture-button').disabled); }

try {
  await page.goto(origin);
  await page.waitForFunction(() => document.querySelector('.local-badge').textContent.includes('sin conexión'), undefined, { timeout: 60000 });
  await page.screenshot({ path: join(outputDirectory, 'empty-desktop.png'), fullPage: true });
  await context.setOffline(true);
  await page.reload();
  await open('bframes-2997.mp4');
  for (let index = 0; index < 10; index++) await page.keyboard.press('ArrowRight');
  await timecode('00:00:00:10');
  await page.keyboard.press('ArrowLeft');
  await timecode('00:00:00:09');
  const tc = page.getByRole('textbox', { name: 'Código de tiempo SMPTE' });
  await tc.fill('00:00:01:00'); await tc.press('Enter'); await timecode('00:00:01:00');
  await ready();
  await page.keyboard.press('c');
  await page.locator('.capture-card').waitFor();
  const png = await download(() => page.getByRole('button', { name: 'Descargar fotograma', exact: true }).click(), 'capture.png');
  const pngBytes = await readFile(png.path);
  assert.deepEqual([pngBytes.readUInt32BE(16), pngBytes.readUInt32BE(20)], [640, 360]);
  assert.equal(png.name, 'bframes-2997_00-00-01-00.png');
  await page.getByRole('button', { name: 'Previsualizar captura 1', exact: true }).click();
  await page.locator('.preview-dialog').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'JPG', exact: true }).click();
  assert.equal(await page.locator('#quality').inputValue(), '95');
  const jpg = await download(() => page.getByRole('button', { name: 'Descargar fotograma', exact: true }).click(), 'capture.jpg');
  assert.deepEqual([...new Uint8Array(await readFile(jpg.path)).slice(0, 2)], [255, 216]);
  await page.getByRole('button', { name: 'WEBP', exact: true }).click();
  const webp = await download(() => page.getByRole('button', { name: 'Descargar fotograma', exact: true }).click(), 'capture.webp');
  assert.equal((await readFile(webp.path)).subarray(8, 12).toString(), 'WEBP');
  await page.getByRole('button', { name: 'TIFF', exact: true }).click();
  const tiff = await download(() => page.getByRole('button', { name: 'Descargar fotograma', exact: true }).click(), 'capture.tif');
  assert.deepEqual([...new Uint8Array(await readFile(tiff.path)).slice(0, 4)], [0x49, 0x49, 42, 0]);
  await page.getByRole('button', { name: 'PNG', exact: true }).click();
  await page.getByRole('tab', { name: 'Por rango' }).click();
  const rangeMode = page.getByRole('combobox', { name: 'Extraer', exact: true });
  await selectOption(page, rangeMode, 'Todos los cuadros del primer segundo');
  await expect(page.locator('#interval')).toHaveCount(0);
  await selectOption(page, rangeMode, 'Un fotograma cada intervalo');
  await page.locator('#interval').fill('1');
  await page.getByRole('button', { name: 'Extraer rango', exact: true }).click();
  await ready();
  assert.equal(await page.locator('.capture-card').count(), 4);
  const archive = await download(() => page.getByRole('button', { name: /Descargar ZIP/ }).click(), 'captures.zip');
  const entries = unzipSync(new Uint8Array(await readFile(archive.path)));
  assert.equal(Object.keys(entries).length, 4);
  for (const bytes of Object.values(entries)) {
    const dimensions = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.deepEqual([dimensions.getUint32(16), dimensions.getUint32(20)], [640, 360]);
  }
  await page.getByRole('button', { name: 'Eliminar captura 1', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.capture-card').length === 3);
  await selectOption(page, rangeMode, 'Lista de timecodes');
  await page.locator('#timecodes').fill('00:00:00:02\n00:00:00:03');
  await page.getByRole('button', { name: 'Extraer rango', exact: true }).click();
  await ready();
  assert.equal(await page.locator('.capture-card').count(), 5);
  const csv = await download(() => page.getByRole('button', { name: 'CSV', exact: true }).click(), 'captures.csv');
  assert.match(await readFile(csv.path, 'utf8'), /^timecode,seconds,filename,format,width,height,bytes/m);
  const sheet = await download(() => page.getByRole('button', { name: 'Contacto', exact: true }).click(), 'contacts.png');
  assert.equal((await readFile(sheet.path)).subarray(1, 4).toString(), 'PNG');
  await page.getByRole('button', { name: 'Previsualizar captura 1', exact: true }).click();
  await page.getByRole('button', { name: 'A/B', exact: true }).click();
  await page.getByRole('button', { name: 'Previsualizar captura 2', exact: true }).click();
  await page.getByRole('button', { name: 'A/B', exact: true }).click();
  await expect(page.locator('.comparison-dialog')).toBeVisible();
  await page.getByRole('slider', { name: 'Divisor de comparación' }).fill('70');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Atajos de teclado (?)', exact: true }).click();
  await page.locator('.help-dialog').waitFor({ state: 'visible' }); await page.keyboard.press('Escape');
  await open('fallback-mpeg4.avi');
  assert.match(await page.locator('.status-engine').innerText(), /FFmpeg/);
  await page.keyboard.press('ArrowRight'); await timecode('00:00:00:01');
  await page.getByRole('tab', { name: 'Fotograma', exact: true }).click();
  await page.screenshot({ path: join(outputDirectory, 'loaded-desktop.png'), fullPage: true });
  const desktop = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, innerWidth, innerHeight }));
  assert.equal(desktop.width, desktop.innerWidth); assert.equal(desktop.height, desktop.innerHeight);
  await open('prores-alpha.mov');
  await ready();
  const alphaPng = await download(() => page.getByRole('button', { name: 'Descargar fotograma', exact: true }).click(), 'alpha.png');
  const alphaValue = await page.evaluate(async data => {
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
    return ctx.getImageData(0, 0, 1, 1).data[3];
  }, (await readFile(alphaPng.path)).toString('base64'));
  assert.ok(alphaValue > 0 && alphaValue < 255, `Expected preserved alpha, got ${alphaValue}`);
  await open('native-4k.mp4');
  await ready();
  const nativePng = await download(() => page.getByRole('button', { name: 'Descargar fotograma', exact: true }).click(), 'native-4k.png');
  const nativeBytes = await readFile(nativePng.path);
  assert.deepEqual([nativeBytes.readUInt32BE(16), nativeBytes.readUInt32BE(20)], [3840, 2160]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(outputDirectory, 'mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  console.log(JSON.stringify({ result: 'PASS', checks: ['offline reload and local input', '10 rapid exact steps', 'SMPTE seek', 'native-size PNG, JPEG, WebP and TIFF export', 'tray, ZIP, CSV and contact sheet', 'interval and pasted-timecode extraction', 'A/B comparison', 'preview and keyboard help', 'offline FFmpeg AVI', 'ProRes alpha PNG', 'native 4K PNG export', 'desktop/mobile layout', 'no external requests or runtime errors'], outputDirectory }, null, 2));
} finally { await browser.close(); }
