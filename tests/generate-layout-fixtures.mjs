import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

// Synthetic local media for aspect-ratio layout checks; no downloads or personal media.
// Run: node tests/generate-layout-fixtures.mjs [output-directory]
const run = promisify(execFile);
const outputDirectory = process.argv[2] || process.env.PIXELFRAME_FIXTURES || '/private/tmp/pixelframe-test-fixtures';
await mkdir(outputDirectory, { recursive: true });
const fixtures = [
  { name: 'portrait-720.mp4', width: 720, height: 1280 },
  { name: 'square-720.mp4', width: 720, height: 720 },
];
const results = await Promise.allSettled(fixtures.map(async ({ name, width, height }) => {
  const path = join(outputDirectory, name);
  await run(process.env.PIXELFRAME_FFMPEG_PATH || 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    `testsrc2=size=${width}x${height}:rate=30:duration=2`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', path,
  ]);
  const { stdout } = await run(process.env.PIXELFRAME_FFPROBE_PATH || 'ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name', '-of', 'json', path,
  ]);
  const stream = JSON.parse(stdout).streams[0];
  assert.deepEqual([stream.width, stream.height, stream.codec_name], [width, height, 'h264']);
  return name;
}));
for (const result of results) {
  if (result.status === 'rejected') {
    console.error(result.reason);
    process.exitCode = 1;
  }
}
if (!process.exitCode) console.log(`Created portrait and square H.264 fixtures in ${outputDirectory}`);
