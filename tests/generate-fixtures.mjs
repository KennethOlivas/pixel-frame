import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

// Synthetic local sources only. This never downloads or uses personal media.
// Run: node tests/generate-fixtures.mjs [output-directory]
const run = promisify(execFile)
const outputDirectory = process.argv[2] || '/private/tmp/pixelframe-test-fixtures'
const ffmpegExecutable = process.env.PIXELFRAME_FFMPEG_PATH || 'ffmpeg'
const ffprobeExecutable = process.env.PIXELFRAME_FFPROBE_PATH || 'ffprobe'
await mkdir(outputDirectory, { recursive: true })

const fixtures = [
  {
    name: 'native-4k.mp4',
    expectedEngine: 'webcodecs',
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=1:duration=1',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'],
  },
  {
    name: 'bframes-2997.mp4',
    expectedEngine: 'webcodecs',
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30000/1001:duration=2',
      '-c:v', 'libx264', '-bf', '3', '-g', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'],
  },
  {
    name: 'prores.mov',
    expectedEngine: 'prores',
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=1',
      '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le'],
  },
  {
    name: 'fallback-mpeg4.avi',
    expectedEngine: 'ffmpeg',
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=1',
      '-c:v', 'mpeg4', '-bf', '0', '-g', '12', '-q:v', '3'],
  },
  {
    name: 'variable-framerate.webm',
    expectedEngine: 'webcodecs',
    args: ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=2',
      '-vf', "select='not(mod(n,2))+not(mod(n,5))'", '-fps_mode', 'vfr',
      '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p'],
  },
  {
    name: 'prores-alpha.mov',
    expectedEngine: 'prores',
    args: ['-f', 'lavfi', '-i', 'color=color=red@0.5:size=160x90:rate=24:duration=0.5,format=rgba',
      '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le'],
  },
]

const results = await Promise.allSettled(fixtures.map(async ({ name, args, expectedEngine }) => {
  const path = join(outputDirectory, name)
  await run(ffmpegExecutable, ['-hide_banner', '-loglevel', 'error', ...args, '-y', path])
  const { stdout } = await run(ffprobeExecutable, [
    '-v', 'error', '-select_streams', 'v:0', '-show_streams', '-show_frames',
    '-show_entries', 'frame=best_effort_timestamp_time,pkt_duration_time,width,height:stream=width,height,codec_name,avg_frame_rate,r_frame_rate,pix_fmt,duration',
    '-of', 'json', path,
  ])
  const probe = JSON.parse(stdout)
  return {
    name, path, expectedEngine,
    stream: probe.streams[0],
    timestamps: probe.frames.map(frame => Number(frame.best_effort_timestamp_time)),
  }
}))

const errors = results.filter(result => result.status === 'rejected')
if (errors.length) {
  for (const result of errors) console.error(result.reason)
  process.exitCode = 1
} else {
  const manifest = results.map(result => result.value)
  await writeFile(join(outputDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`Created ${manifest.length} synthetic fixtures and PTS manifest in ${outputDirectory}`)
}
