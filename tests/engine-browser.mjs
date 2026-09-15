import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'

// Generate synthetic fixtures with tests/generate-fixtures.mjs first, then run
// against the Vite dev server: node tests/engine-browser.mjs
const require = createRequire(new URL('../package.json', import.meta.url))
const { chromium } = require('@playwright/test')
const origin = process.env.PIXELFRAME_URL || 'http://localhost:5173'
const fixtureDirectory = process.env.PIXELFRAME_FIXTURES || '/private/tmp/pixelframe-test-fixtures'
const fixtureFilter = process.argv[2] || process.env.PIXELFRAME_FIXTURE
const fixtures = JSON.parse(await readFile(join(fixtureDirectory, 'manifest.json'), 'utf8'))
  .filter(fixture => !fixtureFilter || fixture.name.includes(fixtureFilter))
const browser = await chromium.launch({
  executablePath: process.env.PIXELFRAME_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const checks = []

try {
  const page = await browser.newPage()
  const externalRequests = []
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(origin).origin) externalRequests.push(request.url())
  })
  await page.goto(origin)

  for (const fixture of fixtures) {
    const bytes = await readFile(join(fixtureDirectory, fixture.name))
    const expected = fixture.timestamps
    const result = await page.evaluate(async ({ data, name }) => {
      const { openMedia } = await import('/src/lib/media.ts')
      const file = new File([Uint8Array.from(atob(data), character => character.charCodeAt(0))], name)
      const session = await openMedia(file)
      try {
        const metadata = session.metadata
        const first = await session.getFrame(metadata.startTime)
        const context = first.canvas.getContext('2d')
        const originalPixels = Array.from(context.getImageData(0, 0, 10, 10).data)
        const alpha = originalPixels[3]
        const dimensions = [first.canvas.width, first.canvas.height]
        const times = [first.time]
        let frame = first
        for (let index = 0; index < 100; index++) {
          const next = await session.getAdjacentFrame(frame.time, 1)
          if (next.time === frame.time) break
          times.push(next.time)
          frame = next
        }
        const last = await session.getFrame(metadata.duration)
        const previous = []
        for (let index = 0; index < times.length - 1; index++) {
          frame = await session.getAdjacentFrame(frame.time, -1)
          previous.push(frame.time)
        }
        const thumb = await session.getThumbnail(0.1)
        const rangeTimes = []
        for await (const result of session.frames(0.2, 0.4)) rangeTimes.push(result.time)
        const cancelled = new AbortController()
        cancelled.abort()
        let abortName = ''
        try { await session.getFrame(0, cancelled.signal) } catch (error) { abortName = error.name }
        const currentPixels = context.getImageData(0, 0, 10, 10).data
        const pixelsUnchanged = originalPixels.every((value, index) => value === currentPixels[index])
        session.close()
        session.close()
        let closedName = ''
        try { await session.getFrame(0) } catch (error) { closedName = error.name }
        return { metadata, times, previous, dimensions, alpha, lastTime: last.time, thumbWidth: thumb.canvas.width, rangeTimes, abortName, closedName, pixelsUnchanged }
      } finally {
        session.close()
      }
    }, { data: bytes.toString('base64'), name: fixture.name })

    const label = fixture.name
    assert.equal(result.metadata.engine, fixture.expectedEngine, `${label}: decoder route`)
    assert.equal(result.times.length, expected.length, `${label}: count`)
    for (let index = 0; index < expected.length; index++) {
      assert.ok(Math.abs(result.times[index] - expected[index]) < 0.000002,
        `${label}: forward frame ${index}: ${result.times[index]} vs ${expected[index]}`)
    }
    for (let index = 0; index < result.previous.length; index++) {
      assert.ok(Math.abs(result.previous[index] - expected[expected.length - index - 2]) < 0.000002,
        `${label}: reverse frame ${index}: ${result.previous[index]} vs ${expected[expected.length - index - 2]}`)
    }
    assert.ok(Math.abs(result.lastTime - expected.at(-1)) < 0.000002, `${label}: seek to end`)
    assert.deepEqual(result.dimensions, [fixture.stream.width, fixture.stream.height], `${label}: native dimensions`)
    assert.equal(result.thumbWidth, Math.min(320, fixture.stream.width), `${label}: thumbnail dimensions`)
    assert.equal(result.abortName, 'AbortError', `${label}: cancellation`)
    assert.ok(['AbortError', 'InvalidStateError'].includes(result.closedName), `${label}: closed decoder`)
    assert.equal(result.pixelsUnchanged, true, `${label}: captured canvas remains stable`)
    assert.equal(result.rangeTimes.length, expected.filter(time => time >= 0.2 && time < 0.4).length, `${label}: [start, end) range`)
    if (label.includes('alpha')) assert.ok(result.alpha > 10 && result.alpha < 245, `${label}: transparent source alpha is preserved (${result.alpha})`)
    if (label.includes('variable')) assert.equal(result.metadata.variableFrameRate, true, `${label}: VFR detected`)
    if (label.includes('2997')) assert.ok(Math.abs(result.metadata.fps - 30000 / 1001) < 1e-9, `${label}: exact fractional frame rate`)
    checks.push({ fixture: label, engine: result.metadata.engine, frames: result.times.length, dimensions: result.dimensions, alpha: result.alpha, fps: result.metadata.fps, variableFrameRate: result.metadata.variableFrameRate })
    console.log(`PASS ${label}: ${result.times.length} forward/reverse frames, native resolution, ranges, cancellation`)
  }
  assert.deepEqual(externalRequests, [], 'No source bytes or decoder requests leave the app origin')
  console.log(JSON.stringify(checks, null, 2))
} finally {
  await browser.close()
}
