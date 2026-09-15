import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { clampMediaTime, mediaAspectRatio, summarizeFrameRate } from '../src/lib/media'

describe('media timestamps and metadata', () => {
  it('clamps a seek to the real track start and end without frame-rate rounding', () => {
    assert.equal(clampMediaTime(-1, 0.041708, 8.04), 0.041708)
    assert.equal(clampMediaTime(0.063, 0.041708, 8.04), 0.063)
    assert.equal(clampMediaTime(Infinity, 0.041708, 8.04), 8.04)
    assert.equal(clampMediaTime(NaN, 0.041708, 8.04), 0.041708)
  })

  it('represents portrait, landscape, and cinema display ratios', () => {
    assert.equal(mediaAspectRatio(3840, 2160), '16:9')
    assert.equal(mediaAspectRatio(1080, 1920), '9:16')
    assert.equal(mediaAspectRatio(4096, 1716), '2.39:1')
  })

  it('keeps fractional rates and identifies sampled variable-frame-rate media', () => {
    const metrics = {
      underlyingFrameRate: 30000 / 1001, bestGuessFrameRate: 30000 / 1001,
      minFrameRate: 30000 / 1001, maxFrameRate: 30000 / 1001,
      averageFrameRate: 30000 / 1001, medianFrameRate: 30000 / 1001,
      frameRateIsConstant: true, probedPacketCount: 256,
    }
    assert.deepEqual(summarizeFrameRate(metrics), {
      fps: 30000 / 1001, variableFrameRate: false, fpsConfidence: 'sampled',
    })
    assert.equal(summarizeFrameRate({ ...metrics, underlyingFrameRate: null, frameRateIsConstant: false }).variableFrameRate, true)
    assert.equal(summarizeFrameRate({ ...metrics, probedPacketCount: 1, bestGuessFrameRate: 16384 }).fps, null)
    assert.equal(summarizeFrameRate({ ...metrics, bestGuessFrameRate: 16384 }).fps, null)
    assert.deepEqual(summarizeFrameRate(null), { fps: null, variableFrameRate: null, fpsConfidence: 'unknown' })
  })
})
