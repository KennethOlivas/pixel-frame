import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg'
import type { DecodedFrame, MediaMetadata, MediaSession } from './media'

type ProbeStream = {
  width?: number
  height?: number
  codec_name?: string
  avg_frame_rate?: string
  r_frame_rate?: string
  display_aspect_ratio?: string
  start_time?: string
  duration?: string
  nb_frames?: string
  side_data_list?: { rotation?: number }[]
  tags?: { rotate?: string }
  color_transfer?: string
}
type ProbeResult = {
  streams?: ProbeStream[]
  format?: { duration?: string; start_time?: string; format_name?: string }
  frames?: { best_effort_timestamp_time?: string; pts_time?: string; pkt_duration_time?: string; duration_time?: string }[]
}
type FrameTiming = { time: number; duration: number }

const EPSILON = 0.000002
const COMMAND_TIMEOUT = 120_000

function number(value: string | number | undefined): number | undefined {
  if (value === undefined || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function rate(value: string | undefined): number | null {
  if (!value) return null
  const [numerator, denominator = '1'] = value.split('/')
  const result = Number(numerator) / Number(denominator)
  return Number.isFinite(result) && result > 0 && result <= 1000 ? result : null
}

function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Operación cancelada.', 'AbortError')
}

function aspectRatio(width: number, height: number, declared?: string) {
  if (declared && declared !== '0:1' && declared !== 'N/A') return declared
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a
  const divisor = gcd(width, height)
  return `${width / divisor}:${height / divisor}`
}

/**
 * Software decode for containers/codecs the browser cannot decode. The File is
 * mounted read-only with WORKERFS: importing a multi-GB file never makes a full
 * ArrayBuffer copy. Only the current decoded image lives in the WASM filesystem.
 */
export async function openFfmpegMedia(file: File): Promise<MediaSession> {
  const ffmpeg = new FFmpeg()
  const base = new URL(`${import.meta.env.BASE_URL}ffmpeg/`, window.location.href)
  const sourcePath = '/source/video'
  let closed = false
  let queue: Promise<unknown> = Promise.resolve()
  let lastTimings: FrameTiming[] = []
  let indexedThrough = -Infinity
  let recentLogs: string[] = []

  const logListener = ({ message }: { message: string }) => {
    recentLogs.push(message)
    if (recentLogs.length > 30) recentLogs.shift()
  }
  ffmpeg.on('log', logListener)

  function assertOpen(signal?: AbortSignal) {
    abortIfNeeded(signal)
    if (closed) throw new DOMException('El video ya se cerró.', 'AbortError')
  }

  // FFmpeg shares one filesystem and one decoder. Aborted requests finish their
  // worker command before the next request may touch those resources.
  function serialized<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const result = queue.then(async () => {
      assertOpen(signal)
      return work()
    })
    queue = result.catch(() => undefined)
    return result
  }

  async function probe(args: string[]): Promise<ProbeResult> {
    recentLogs = []
    const output = '/probe.json'
    try {
      const exitCode = await ffmpeg.ffprobe(['-v', 'error', ...args, '-of', 'json', '-o', output, sourcePath], COMMAND_TIMEOUT)
      // ffmpeg-core 0.12.10 can leave its shared return slot at -1 when ffprobe
      // returns normally. A valid generated JSON file is still a successful
      // probe; positive exit codes and missing/invalid output remain failures.
      if (exitCode !== 0 && exitCode !== -1) throw new Error('No se pudieron leer los metadatos de este video.')
      const content = await ffmpeg.readFile(output, 'utf8')
      return JSON.parse(String(content)) as ProbeResult
    } finally {
      await ffmpeg.deleteFile(output).catch(() => undefined)
    }
  }

  let metadata: MediaMetadata
  try {
    await ffmpeg.load({
      classWorkerURL: new URL('worker/worker.js', base).href,
      coreURL: new URL('ffmpeg-core.js', base).href,
      wasmURL: new URL('ffmpeg-core.wasm', base).href,
    })
    await ffmpeg.createDir('/source')
    const mounted = await ffmpeg.mount(FFFSType.WORKERFS, { blobs: [{ name: 'video', data: file }] }, '/source')
    if (!mounted) throw new Error('Este navegador no permite leer el archivo local con WORKERFS.')
    const info = await probe(['-select_streams', 'v:0', '-show_streams', '-show_format'])
    const stream = info.streams?.[0]
    if (!stream?.width || !stream.height) throw new Error('El archivo no contiene una pista de video compatible.')
    const startTime = number(stream.start_time) ?? number(info.format?.start_time) ?? 0
    const length = number(stream.duration) ?? number(info.format?.duration)
    if (length === undefined || length <= 0) throw new Error('No se pudo determinar la duración del video.')
    const fps = rate(stream.avg_frame_rate) ?? rate(stream.r_frame_rate)
    const nominalRate = rate(stream.r_frame_rate)
    const rotation = ((stream.side_data_list?.find(item => item.rotation !== undefined)?.rotation ?? number(stream.tags?.rotate) ?? 0) % 360 + 360) % 360
    const rotated = rotation === 90 || rotation === 270
    const width = rotated ? stream.height : stream.width
    const height = rotated ? stream.width : stream.height
    metadata = {
      name: file.name,
      size: file.size,
      width,
      height,
      codedWidth: stream.width,
      codedHeight: stream.height,
      rotation,
      hdr: stream.color_transfer === 'smpte2084' || stream.color_transfer === 'arib-std-b67',
      duration: startTime + length,
      startTime,
      fps,
      codec: stream.codec_name?.toUpperCase() ?? 'Desconocido',
      container: file.name.split('.').pop()?.toUpperCase() || info.format?.format_name || 'Video',
      engine: 'ffmpeg',
      nativePlayable: false,
      precision: 'estimated',
      fpsConfidence: fps ? 'container' : 'unknown',
      variableFrameRate: fps && nominalRate && Math.abs(fps - nominalRate) > 0.02 ? true : null,
      aspectRatio: aspectRatio(width, height, rotated ? undefined : stream.display_aspect_ratio),
      ...(number(stream.nb_frames) ? { frameCount: number(stream.nb_frames) } : {}),
    }
  } catch (error) {
    ffmpeg.terminate()
    throw error instanceof Error ? error : new Error('No se pudo abrir este formato con el decodificador local.')
  }

  function clampTime(time: number) {
    return Math.max(metadata.startTime, Math.min(Number.isFinite(time) ? time : metadata.startTime, metadata.duration - EPSILON))
  }

  async function indexAround(time: number, signal?: AbortSignal, padding = 1.5): Promise<void> {
    assertOpen(signal)
    const from = Math.max(metadata.startTime, time - padding)
    const until = Math.min(metadata.duration + EPSILON, time + padding)
    // read_intervals seeks to the preceding keyframe. Absolute end positions
    // avoid truncating the window when that keyframe is earlier than requested.
    const result = await probe([
      '-select_streams', 'v:0',
      '-read_intervals', `${from.toFixed(6)}%${until.toFixed(6)}`,
      '-show_frames',
      '-show_entries', 'frame=best_effort_timestamp_time,pts_time,pkt_duration_time,duration_time',
    ])
    assertOpen(signal)
    const timings = (result.frames ?? []).flatMap(frame => {
      const timestamp = number(frame.best_effort_timestamp_time) ?? number(frame.pts_time)
      if (timestamp === undefined) return []
      return [{ time: timestamp, duration: number(frame.duration_time) ?? number(frame.pkt_duration_time) ?? 0 }]
    }).sort((a, b) => a.time - b.time).filter((frame, index, all) => index === 0 || frame.time - all[index - 1].time > EPSILON)
    if (!timings.length) throw new Error('El video no ofrece fotogramas con marcas de tiempo en este punto.')
    if (timings[0].time > time + EPSILON && from > metadata.startTime + EPSILON) {
      // Retry from the beginning if a damaged seek index skipped over our time.
      return indexAround(time, signal, time - metadata.startTime + padding)
    }
    for (let i = 0; i < timings.length; i++) {
      const next = timings[i + 1]
      if (next) timings[i].duration = next.time - timings[i].time
      else if (timings[i].duration <= 0) timings[i].duration = Math.min(metadata.duration - timings[i].time, 1 / (metadata.fps || 30))
    }
    const durations = timings.slice(0, -1).map(frame => frame.duration)
    // Allow timestamp rounding (e.g. Matroska millisecond ticks for 29.97fps).
    if (durations.length > 2 && Math.max(...durations) - Math.min(...durations) > 0.002) metadata.variableFrameRate = true
    lastTimings = timings
    indexedThrough = until
  }

  async function timingAt(time: number, direction: -1 | 0 | 1, signal?: AbortSignal): Promise<FrameTiming> {
    const target = clampTime(time)
    if (!lastTimings.length || target < lastTimings[0].time - EPSILON || target >= lastTimings[lastTimings.length - 1].time - EPSILON) {
      await indexAround(target, signal)
    }
    let match: FrameTiming | undefined
    if (direction === 1) match = lastTimings.find(frame => frame.time > target + EPSILON)
    else if (direction === -1) match = [...lastTimings].reverse().find(frame => frame.time < target - EPSILON)
    else match = [...lastTimings].reverse().find(frame => frame.time <= target + EPSILON)
    let padding = 8
    while (!match && direction === 1 && indexedThrough < metadata.duration) {
      // Sparse/VFR videos can hold one frame longer than the small cache window.
      await indexAround(target, signal, padding)
      match = lastTimings.find(frame => frame.time > target + EPSILON)
      padding *= 2
    }
    return match ?? (direction === 1 ? lastTimings[lastTimings.length - 1] : lastTimings[0])
  }

  async function decode(timing: FrameTiming, thumbnail: boolean, signal?: AbortSignal, sequential = false): Promise<DecodedFrame> {
    assertOpen(signal)
    recentLogs = []
    const output = '/frame.png'
    let decodedTime: number | undefined
    let timestampScale: number | undefined
    const observeTimestamp = ({ message }: { message: string }) => {
      if (decodedTime !== undefined || !message.includes('showinfo')) return
      const timeBase = /config in time_base:\s*(\d+)\/(\d+)/.exec(message)
      if (timeBase) timestampScale = Number(timeBase[1]) / Number(timeBase[2])
      const pts = /\bpts:\s*([\d-]+)/.exec(message)
      if (pts && timestampScale !== undefined) {
        decodedTime = Number(pts[1]) * timestampScale
        return
      }
      const match = /\bpts_time:([\d.eE+-]+)/.exec(message)
      if (match) decodedTime = number(match[1])
    }
    ffmpeg.on('log', observeTimestamp)
    try {
      const filters = [`select=gte(t\\,${(timing.time - EPSILON).toFixed(6)})`, 'showinfo']
      if (thumbnail) filters.push(`scale=${Math.min(320, metadata.width)}:-1`)
      const seekTime = Math.max(metadata.startTime, timing.time - 1)
      // Some AVI demuxers mishandle an explicit seek to the very beginning.
      const seekArgs = !sequential && seekTime > metadata.startTime + EPSILON
        ? ['-ss', seekTime.toFixed(6), '-seek_timestamp', '1']
        : []
      const exitCode = await ffmpeg.exec([
        '-hide_banner', '-loglevel', 'info', '-copyts',
        ...seekArgs,
        '-i', sourcePath,
        '-map', '0:v:0', '-an', '-sn', '-dn',
        '-vf', filters.join(','), '-frames:v', '1', '-fps_mode', 'passthrough',
        '-c:v', 'png', '-pix_fmt', 'rgba', '-f', 'image2', '-update', '1', output,
      ], COMMAND_TIMEOUT)
      assertOpen(signal)
      if (exitCode !== 0) {
        const missingCodec = recentLogs.some(line => /decoder.*not found|unknown decoder|unsupported codec/i.test(line))
        throw new Error(missingCodec ? 'Este códec no está incluido en el decodificador local.' : 'No se pudo decodificar este fotograma. Prueba otro punto del video.')
      }
      const data = await ffmpeg.readFile(output)
      if (typeof data === 'string' || !data.length) throw new Error('No se encontró un fotograma en este punto del video.')
      // Source PTS are authoritative. Never label a requested time as the actual
      // frame timestamp if the decoder returned a different frame.
      const actualTime = decodedTime ?? timing.time
      if (decodedTime !== undefined && Math.abs(actualTime - timing.time) > EPSILON * 2) {
        if (!sequential && seekArgs.length) {
          // Damaged container seek indexes can land past the requested frame.
          // Decode up to this frame without seeking, still retaining one PNG.
          ffmpeg.off('log', observeTimestamp)
          return await decode(timing, thumbnail, signal, true)
        }
        throw new Error('El decodificador no pudo confirmar el fotograma solicitado en este archivo.')
      }
      metadata.precision = decodedTime === undefined ? 'estimated' : 'exact'
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/png' }))
      try {
        assertOpen(signal)
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const context = canvas.getContext('2d', { alpha: true })
        if (!context) throw new Error('No se pudo crear el lienzo de captura.')
        context.drawImage(bitmap, 0, 0)
        return { canvas, time: actualTime, duration: timing.duration }
      } finally {
        bitmap.close()
      }
    } finally {
      ffmpeg.off('log', observeTimestamp)
      await ffmpeg.deleteFile(output).catch(() => undefined)
    }
  }

  const session: MediaSession = {
    metadata,
    getFrame: (time, signal) => serialized(async () => decode(await timingAt(time, 0, signal), false, signal), signal),
    getAdjacentFrame: (time, direction, signal) => serialized(async () => decode(await timingAt(time, direction, signal), false, signal), signal),
    getThumbnail: (time, signal) => serialized(async () => decode(await timingAt(time, 0, signal), true, signal), signal),
    async *frames(start, end, signal) {
      if (end <= start) return
      let frame = await session.getFrame(start, signal)
      if (frame.time < start - EPSILON) frame = await session.getAdjacentFrame(frame.time, 1, signal)
      while (frame.time < end - EPSILON) {
        assertOpen(signal)
        yield frame
        const next = await session.getAdjacentFrame(frame.time, 1, signal)
        if (next.time <= frame.time + EPSILON) break
        frame = next
      }
    },
    close() {
      if (closed) return
      closed = true
      lastTimings = []
      ffmpeg.off('log', logListener)
      ffmpeg.terminate()
    },
  }
  return session
}
