import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatFrameTimecode, formatTimecode, frameIndexAtTime, frameTime,
  normalizeFrameRate, parseTimecode,
} from '../src/lib/timecode';

test('integer-rate timecode rolls over exactly at frame, minute, and hour boundaries', () => {
  assert.equal(formatFrameTimecode(23, 24), '00:00:00:23');
  assert.equal(formatFrameTimecode(24, 24), '00:00:01:00');
  assert.equal(formatFrameTimecode(24 * 60 - 1, 24), '00:00:59:23');
  assert.equal(formatFrameTimecode(24 * 3600, 24), '01:00:00:00');
  assert.equal(formatFrameTimecode(24 * 3600 * 100, 24), '100:00:00:00');
});

test('fractional rates retain rational timing and count all frames in non-drop timecode', () => {
  assert.deepEqual(normalizeFrameRate(23.976), { numerator: 24000, denominator: 1001 });
  assert.deepEqual(normalizeFrameRate(29.97), { numerator: 30000, denominator: 1001 });
  assert.deepEqual(normalizeFrameRate(59.94), { numerator: 60000, denominator: 1001 });
  assert.equal(formatTimecode(60, 29.97), '00:00:59:28');
  assert.equal(parseTimecode('00:01:00:00', 29.97), 60.06);
  assert.equal(parseTimecode('01:00:00:00', 23.976), 3603.6);
});

test('timecode round trips preserve frame identity across fractional rates and long durations', () => {
  for (const fps of [24, 25, 30, 23.976, 29.97, 59.94, { numerator: 24000, denominator: 1001 }]) {
    for (const index of [0, 1, 23, 24, 29, 30, 1439, 1440, 107892, 5_000_001]) {
      const label = formatFrameTimecode(index, fps);
      const time = parseTimecode(label, fps);
      assert.notEqual(time, null);
      assert.equal(frameIndexAtTime(time!, fps), index);
      assert.equal(formatTimecode(frameTime(index, fps), fps), label);
    }
  }
});

test('frame lookup uses the presentation interval instead of rounding to the next frame', () => {
  assert.equal(frameIndexAtTime(0.041, 24), 0);
  assert.equal(frameIndexAtTime(1 / 24, 24), 1);
  assert.equal(frameIndexAtTime(0.999, 24), 23);
  assert.equal(frameIndexAtTime(1001 / 30000, 29.97), 1);
  assert.equal(frameIndexAtTime(0.033333, 30), 1);
  assert.equal(frameIndexAtTime(0.041708, 23.976), 1);
  assert.equal(frameIndexAtTime(0.03333, 30), 0);
});

test('malformed or out-of-range timecodes are rejected instead of silently seeking elsewhere', () => {
  for (const text of ['00:00:00:24', '00:60:00:00', '00:00:60:00', '-1:00:00:00', '1:00:00:00',
    '00:00:00;00', '00:00:00:0', '00:00:00:00junk', '00:00:00', '99999999999999999:00:00:00']) {
    assert.equal(parseTimecode(text, 24), null, text);
  }
  assert.equal(parseTimecode(' 00:00:01:00 ', 24), 1);
});

test('invalid rates, times, and frame indices cannot produce misleading labels', () => {
  for (const rate of [0, -1, NaN, Infinity, 1001]) assert.throws(() => normalizeFrameRate(rate), RangeError);
  assert.throws(() => normalizeFrameRate({ numerator: 24, denominator: 0 }), RangeError);
  assert.throws(() => normalizeFrameRate({ numerator: 23.976, denominator: 1 }), RangeError);
  assert.throws(() => frameTime(0.5, 24), RangeError);
  assert.throws(() => formatTimecode(-1, 24), RangeError);
  assert.throws(() => formatTimecode(Infinity, 24), RangeError);
  assert.deepEqual(normalizeFrameRate({ numerator: 48000, denominator: 2002 }), { numerator: 24000, denominator: 1001 });
});
