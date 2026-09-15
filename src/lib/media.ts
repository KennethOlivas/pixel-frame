import {
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  EncodedPacketSink,
  Input,
  type FrameRateMetrics,
  type InputVideoTrack,
  type WrappedCanvas,
} from 'mediabunny'

export interface MediaMetadata {
  name: string
  size: number
  /** Export dimensions, including the source's display orientation. */
  width: number
  height: number
  /** End timestamp in seconds; the timeline begins at startTime. */
  duration: number
  startTime: number
  fps: number | null
  codec: string
  container: string
  aspectRatio: string
  /** Precision refers to decoded presentation timestamps, not bit depth. */
  precision: 'exact' | 'estimated'
  engine: 'webcodecs' | 'prores' | 'ffmpeg'
  variableFrameRate: boolean | null
  fpsConfidence: 'sampled' | 'container' | 'unknown'
  frameCount?: number
  codedWidth?: number
  codedHeight?: number
  rotation?: number
  hdr?: boolean
  nativePlayable?: boolean
}

export interface DecodedFrame {
  canvas: HTMLCanvasElement | OffscreenCanvas
  /** Actual presentation timestamp of the decoded frame, in seconds. */
  time: number
  duration: number
}

export interface MediaSession {
  readonly metadata: MediaMetadata
  getFrame(time: number, signal?: AbortSignal): Promise<DecodedFrame>
  getAdjacentFrame(time: number, direction: -1 | 1, signal?: AbortSignal): Promise<DecodedFrame>
  getThumbnail(time: number, signal?: AbortSignal): Promise<DecodedFrame>
  /** Every actual frame in [start, end), in presentation order. */
  frames(start: number, end: number, signal?: AbortSignal): AsyncGenerator<DecodedFrame>
  close(): void
}

const CODEC_NAMES: Record<string, string> = {
  avc: 'H.264', hevc: 'H.265 / HEVC', vp8: 'VP8', vp9: 'VP9', av1: 'AV1', prores: 'Apple ProRes',
}

export function mediaAspectRatio(width: number, height: number): string {
  if (!(width > 0 && height > 0)) return '—'
  let a = Math.round(width)
  let b = Math.round(height)
  while (b !== 0) [a, b] = [b, a % b]
  const numerator = Math.round(width) / a
  const denominator = Math.round(height) / a
  return numerator <= 32 && denominator <= 32
    ? `${numerator}:${denominator}`
    : `${(width / height).toFixed(2)}:1`
}

export function clampMediaTime(time: number, start: number, end: number): number {
  if (Number.isNaN(time)) return start
  return Math.max(start, Math.min(end, time))
}

/** Keep measured VFR distinct from a nominal timecode rate. Never invent 30 fps. */
export function summarizeFrameRate(metrics: FrameRateMetrics | null): Pick<MediaMetadata,
  'fps' | 'variableFrameRate' | 'fpsConfidence'> {
  if (!metrics || metrics.probedPacketCount < 2 || !Number.isFinite(metrics.bestGuessFrameRate) || metrics.bestGuessFrameRate <= 0 || metrics.bestGuessFrameRate > 1000) {
    return { fps: null, variableFrameRate: null, fpsConfidence: 'unknown' }
  }
  return {
    fps: metrics.bestGuessFrameRate,
    variableFrameRate: !metrics.frameRateIsConstant,
    fpsConfidence: 'sampled',
  }
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Operación cancelada.', 'AbortError')
}

function asFrame(result: WrappedCanvas): DecodedFrame {
  return { canvas: result.canvas, time: result.timestamp, duration: result.duration }
}

let proresRegistration: Promise<void> | undefined

async function registerProres(): Promise<void> {
  proresRegistration ??= import('@mediabunny/prores').then(({ registerProresDecoder }) => {
    registerProresDecoder()
  }).catch((error: unknown) => {
    proresRegistration = undefined
    throw error
  })
  await proresRegistration
}

class BrowserMediaSession implements MediaSession {
  readonly metadata: MediaMetadata
  private readonly input: Input
  private readonly track: InputVideoTrack
  private readonly sink: CanvasSink
  private readonly thumbnailSink: CanvasSink
  private readonly packetSink: EncodedPacketSink
  private readonly epsilon: number
  private closed = false
  private queue: Promise<unknown> = Promise.resolve()
  private cachedFrame: DecodedFrame | undefined

  constructor(input: Input, track: InputVideoTrack, metadata: MediaMetadata, timeResolution: number) {
    this.input = input
    this.track = track
    this.metadata = metadata
    // No canvas pool: captured canvases remain stable after subsequent seeks.
    // CanvasSink uses the source's display dimensions and rotation by default.
    this.sink = new CanvasSink(track, { alpha: true })
    this.thumbnailSink = new CanvasSink(track, { width: Math.min(320, metadata.width), alpha: true })
    this.packetSink = new EncodedPacketSink(track)
    // Less than one container tick, while surviving microsecond decoder rounding.
    this.epsilon = Math.max(Number.EPSILON * metadata.duration * 4, Math.min(0.000001, 0.25 / timeResolution))
  }

  private check(signal?: AbortSignal): void {
    abortIfNeeded(signal)
    if (this.closed) throw new DOMException('El archivo ya está cerrado.', 'InvalidStateError')
  }

  private run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const task = this.queue.then(async () => {
      this.check(signal)
      const result = await operation()
      this.check(signal)
      return result
    })
    // Scrubbing never accumulates parallel native-resolution decoder allocations.
    // Superseded requests can be aborted by their caller before reaching the decoder.
    this.queue = task.catch(() => undefined)
    return task
  }

  private async readFrame(sink: CanvasSink, time: number): Promise<DecodedFrame> {
    const target = clampMediaTime(time, this.metadata.startTime, this.metadata.duration)
    if (sink === this.sink && this.cachedFrame?.time === target) return this.cachedFrame
    const result = await sink.getCanvas(target)
    if (!result) throw new Error('No se pudo decodificar un fotograma en este punto del video.')
    const frame = asFrame(result)
    if (sink === this.sink) this.cachedFrame = frame
    return frame
  }

  getFrame(time: number, signal?: AbortSignal): Promise<DecodedFrame> {
    return this.run(() => this.readFrame(this.sink, time), signal)
  }

  getThumbnail(time: number, signal?: AbortSignal): Promise<DecodedFrame> {
    return this.run(() => this.readFrame(this.thumbnailSink, time), signal)
  }

  getAdjacentFrame(time: number, direction: -1 | 1, signal?: AbortSignal): Promise<DecodedFrame> {
    return this.run(async () => {
      const target = clampMediaTime(time, this.metadata.startTime, this.metadata.duration)
      const current = await this.packetSink.getPacket(target, { metadataOnly: true })
      this.check(signal)
      if (!current) return this.readFrame(this.sink, this.metadata.startTime)

      if (direction === -1) {
        // getCanvas returns the last PTS <= target, so stepping just before the
        // current packet gives the true preceding frame even with VFR/B-frames.
        return this.readFrame(this.sink, Math.max(this.metadata.startTime, current.timestamp - this.epsilon))
      }

      // Packet decode order is different from presentation order for B-frames.
      // The canvas iterator handles reordering; 1/fps and getNextPacket do not.
      for await (const next of this.sink.canvases(current.timestamp)) {
        this.check(signal)
        if (next.timestamp > current.timestamp + this.epsilon) {
          const frame = asFrame(next)
          this.cachedFrame = frame
          return frame
        }
      }
      return this.readFrame(this.sink, current.timestamp)
    }, signal)
  }

  async *frames(start: number, end: number, signal?: AbortSignal): AsyncGenerator<DecodedFrame> {
    this.check(signal)
    const from = clampMediaTime(start, this.metadata.startTime, this.metadata.duration)
    const to = clampMediaTime(end, this.metadata.startTime, this.metadata.duration)
    if (to <= from) return
    // A dedicated iterator keeps batch extraction independent of UI scrubbing.
    const sink = new CanvasSink(this.track, { alpha: true })
    for await (const frame of sink.canvases(from, to)) {
      this.check(signal)
      if (frame.timestamp >= from && frame.timestamp < to) yield asFrame(frame)
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.cachedFrame = undefined
    this.input.dispose()
  }
}

async function openBrowserMedia(file: File): Promise<MediaSession> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('Este archivo no contiene una pista de video.')
    const codec = await track.getCodec()
    if (codec === 'prores') await registerProres()
    if (!await track.canDecode()) {
      throw new Error(`El navegador no puede decodificar ${codec ? CODEC_NAMES[codec] || codec : 'este códec'}.`)
    }

    const [width, height, codedWidth, codedHeight, rotation, start, duration, format, metrics, timeResolution, hdr] = await Promise.all([
      track.getDisplayWidth(), track.getDisplayHeight(), track.getCodedWidth(), track.getCodedHeight(),
      track.getRotation(), track.getFirstTimestamp(), track.computeDuration(), input.getFormat(),
      track.computeFrameRateMetrics({ targetPacketCount: 256 }).catch(() => null),
      track.getTimeResolution(), track.hasHighDynamicRange().catch(() => false),
    ])
    if (!(width > 0 && height > 0 && Number.isFinite(duration) && duration > Math.max(0, start))) {
      throw new Error('No se pudieron leer las dimensiones o la duración de este video.')
    }

    const metadata: MediaMetadata = {
      name: file.name, size: file.size, width, height, codedWidth, codedHeight, rotation,
      duration, startTime: Math.max(0, start), codec: codec ? CODEC_NAMES[codec] || codec : 'Desconocido',
      container: format.name, aspectRatio: mediaAspectRatio(width, height),
      precision: 'exact', engine: codec === 'prores' ? 'prores' : 'webcodecs',
      ...summarizeFrameRate(metrics), hdr,
    }
    const session = new BrowserMediaSession(input, track, metadata, timeResolution)
    // Support probing is advisory: verify real decoder output before committing
    // to this engine, so unsupported profiles can still use the local fallback.
    await session.getFrame(metadata.startTime)
    return session
  } catch (error) {
    input.dispose()
    throw error
  }
}

/** Opens only a local File. Both decoder paths keep every source byte on-device. */
export async function openMedia(file: File): Promise<MediaSession> {
  if (file.size === 0) throw new Error('El archivo está vacío. Selecciona un video válido.')
  try {
    return await openBrowserMedia(file)
  } catch (browserError) {
    try {
      const { openFfmpegMedia } = await import('./ffmpeg-fallback')
      return await openFfmpegMedia(file)
    } catch (fallbackError) {
      const detail = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
      const nativeDetail = browserError instanceof Error ? browserError.message : ''
      throw new Error(`No pudimos abrir este video. ${detail || nativeDetail}`)
    }
  }
}
