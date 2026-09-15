import { AsyncZipDeflate, Zip } from 'fflate';
import { formatTimecode, type FrameRateInput } from './timecode';

export type CaptureFormat = 'png' | 'webp' | 'jpeg';

export interface Capture {
  id: string;
  thumbnailUrl: string;
  time: number;
  timecode: string;
  size: number;
  filename: string;
  width: number;
  height: number;
  format: CaptureFormat;
}

export interface CaptureImageOptions {
  source: CanvasImageSource;
  width: number;
  height: number;
  format?: CaptureFormat;
  /** A fraction from 0.01 to 1; PNG is always lossless. */
  quality?: number;
}

export interface CaptureOptions extends CaptureImageOptions {
  time: number;
  fps: FrameRateInput | null;
  videoName: string;
}

export interface CaptureStoreOptions {
  maxBytes?: number;
  maxMemoryBytes?: number;
  maxCaptures?: number;
  /** Useful for private sessions and environments without persistent storage. */
  useOPFS?: boolean;
}

const MiB = 1024 * 1024;
export const MAX_ZIP_BYTES = 256 * MiB;
export const MAX_IMAGE_PIXELS = 40_000_000;
const MIME: Record<CaptureFormat, string> = { png: 'image/png', webp: 'image/webp', jpeg: 'image/jpeg' };

export function imageMimeType(format: CaptureFormat): string {
  return MIME[format];
}

export function sanitizeVideoName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120);
  return base || 'video';
}

export function captureFilename(videoName: string, timecode: string, format: CaptureFormat, occurrence = 1): string {
  if (!Number.isSafeInteger(occurrence) || occurrence < 1) throw new RangeError('Número de captura no válido.');
  if (!/^\d{2,}:\d{2}:\d{2}(?::\d{2,}|\.\d{3})$/.test(timecode)) throw new RangeError('Código de tiempo no válido.');
  const suffix = occurrence > 1 ? `_${String(occurrence).padStart(2, '0')}` : '';
  return `${sanitizeVideoName(videoName)}_${timecode.replaceAll(':', '-').replace('.', '-')}${suffix}.${format === 'jpeg' ? 'jpg' : format}`;
}

/** Unknown-rate media uses milliseconds instead of inventing a frame rate. */
export function captureTimecode(time: number, fps: FrameRateInput | null): string {
  if (fps !== null) return formatTimecode(time, fps);
  if (!Number.isFinite(time) || time < 0) throw new RangeError('Tiempo de captura no válido.');
  const totalMilliseconds = Math.round(time * 1000);
  const seconds = Math.floor(totalMilliseconds / 1000);
  const fields = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  return `${fields.map((value) => String(value).padStart(2, '0')).join(':')}.${String(totalMilliseconds % 1000).padStart(3, '0')}`;
}

type ExportCanvas = HTMLCanvasElement | OffscreenCanvas;

function createCanvas(width: number, height: number): ExportCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function nativeCanvas({ source, width, height, format = 'png' }: CaptureImageOptions): ExportCanvas {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('El video no tiene dimensiones de fotograma válidas.');
  }
  if (width * height > MAX_IMAGE_PIXELS || width > 32767 || height > 32767) {
    throw new Error('Este fotograma supera el límite de 40 megapíxeles para proteger la memoria.');
  }
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d', { alpha: format !== 'jpeg' });
  if (!context) throw new Error('El navegador no pudo reservar memoria para el fotograma a resolución nativa.');
  if (format === 'jpeg') {
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
  }
  // Export dimensions come from the decoded video, never from a CSS-sized preview.
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

function encodeCanvas(canvas: ExportCanvas, format: CaptureFormat, quality = 0.95): Promise<Blob> {
  const normalizedQuality = Number.isFinite(quality) ? Math.min(1, Math.max(0.01, quality)) : 0.95;
  const validate = (blob: Blob | null): Blob => {
    if (!blob) throw new Error('El navegador no pudo codificar este fotograma. Prueba otro formato.');
    if (blob.type !== MIME[format]) throw new Error(`Este navegador no puede exportar imágenes ${format.toUpperCase()}.`);
    return blob;
  };
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: MIME[format], quality: format === 'png' ? undefined : normalizedQuality }).then(validate);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      try { resolve(validate(blob)); } catch (error) { reject(error); }
    }, MIME[format], format === 'png' ? undefined : normalizedQuality);
  });
}

function releaseCanvas(canvas: ExportCanvas): void {
  canvas.width = 0;
  canvas.height = 0;
}

export async function captureImageBlob(options: CaptureImageOptions): Promise<Blob> {
  const canvas = nativeCanvas(options);
  try {
    return await encodeCanvas(canvas, options.format ?? 'png', options.quality);
  } finally {
    releaseCanvas(canvas);
  }
}

async function thumbnailBlob(source: ExportCanvas): Promise<Blob> {
  const scale = Math.min(1, 256 / source.width, 144 / source.height);
  const canvas = createCanvas(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No se pudo crear la miniatura de la captura.');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  try {
    return await encodeCanvas(canvas, 'jpeg', 0.75);
  } finally {
    releaseCanvas(canvas);
  }
}

interface StoredCapture {
  info: Capture;
  blob?: Blob;
  onDisk: boolean;
}

/** Encoded originals live in OPFS when available; React only needs Capture metadata. */
export class CaptureStore {
  private readonly records = new Map<string, StoredCapture>();
  private readonly maxBytes: number;
  private readonly maxMemoryBytes: number;
  private readonly maxCaptures: number;
  private readonly useOPFS: boolean;
  private readonly directoryName = `${typeof navigator !== 'undefined' && navigator.locks ? 'session-v1' : 'session-unlocked'}-${crypto.randomUUID()}`;
  private directoryPromise?: Promise<FileSystemDirectoryHandle | null>;
  private parentDirectory?: FileSystemDirectoryHandle;
  private releaseSessionLock?: () => void;
  private totalBytes = 0;
  private memoryBytes = 0;
  private capturing = false;
  private closed = false;
  private generation = 0;

  constructor(options: CaptureStoreOptions = {}) {
    this.maxBytes = options.maxBytes ?? 512 * MiB;
    this.maxMemoryBytes = options.maxMemoryBytes ?? 128 * MiB;
    this.maxCaptures = options.maxCaptures ?? 500;
    this.useOPFS = options.useOPFS ?? true;
  }

  get sizeBytes(): number { return this.totalBytes; }
  get count(): number { return this.records.size; }

  private async lockSessionAndCleanStale(parent: FileSystemDirectoryHandle): Promise<void> {
    if (!navigator.locks) return;
    // The browser releases this lock automatically when a tab closes or reloads.
    // Other tabs can safely identify stale directories without racing live captures.
    await new Promise<void>((resolve, reject) => {
      void navigator.locks.request(`pixelframe-${this.directoryName}`, async () => {
        await new Promise<void>((release) => {
          this.releaseSessionLock = release;
          resolve();
        });
      }).catch(reject);
    });
    const iterable = parent as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> };
    let scanned = 0;
    let removed = 0;
    for await (const [name, handle] of iterable.entries()) {
      if (++scanned > 64 || removed >= 8) break;
      if (handle.kind !== 'directory' || name === this.directoryName || !/^session-v1-[a-f0-9-]{36}$/.test(name)) continue;
      await navigator.locks.request(`pixelframe-${name}`, { ifAvailable: true }, async (lock) => {
        if (!lock) return;
        await parent.removeEntry(name, { recursive: true }).catch(() => undefined);
        removed += 1;
      });
    }
  }

  private directory(): Promise<FileSystemDirectoryHandle | null> {
    this.directoryPromise ??= (async () => {
      if (!this.useOPFS || typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
      try {
        const root = await navigator.storage.getDirectory();
        this.parentDirectory = await root.getDirectoryHandle('pixelframe-captures', { create: true });
        await this.lockSessionAndCleanStale(this.parentDirectory);
        return await this.parentDirectory.getDirectoryHandle(this.directoryName, { create: true });
      } catch {
        this.releaseSessionLock?.();
        this.releaseSessionLock = undefined;
        return null;
      }
    })();
    return this.directoryPromise;
  }

  private assertActive(generation: number): void {
    if (this.closed || generation !== this.generation) throw new Error('Captura cancelada.');
  }

  async capture(options: CaptureOptions): Promise<Capture> {
    if (this.closed) throw new Error('El almacén de capturas está cerrado.');
    if (this.capturing) throw new Error('Todavía se está capturando un fotograma.');
    if (this.records.size >= this.maxCaptures) throw new Error(`La bandeja admite ${this.maxCaptures} fotogramas. Descarga y limpia las capturas para continuar.`);
    const generation = this.generation;
    const timecode = captureTimecode(options.time, options.fps);
    // Snapshot before the first await so playback cannot change the captured frame.
    const canvas = nativeCanvas(options);
    this.capturing = true;
    const id = crypto.randomUUID();
    let writtenDirectory: FileSystemDirectoryHandle | null = null;
    let thumbnailUrl: string | undefined;
    try {
      const format = options.format ?? 'png';
      const [blob, thumbnail] = await Promise.all([
        encodeCanvas(canvas, format, options.quality),
        thumbnailBlob(canvas),
      ]);
      this.assertActive(generation);
      if (this.totalBytes + blob.size > this.maxBytes) {
        throw new Error('Se alcanzó el límite de almacenamiento de la bandeja. Descarga y elimina algunas capturas para continuar.');
      }
      const directory = await this.directory();
      this.assertActive(generation);
      let onDisk = false;
      if (directory) {
        try {
          const file = await directory.getFileHandle(id, { create: true });
          const writable = await file.createWritable();
          try {
            await writable.write(blob);
            await writable.close();
          } catch (error) {
            await writable.abort().catch(() => undefined);
            throw error;
          }
          onDisk = true;
          writtenDirectory = directory;
        } catch {
          await directory.removeEntry(id).catch(() => undefined);
        }
      }
      this.assertActive(generation);
      if (!onDisk && this.memoryBytes + blob.size > this.maxMemoryBytes) {
        throw new Error('El almacenamiento en disco no está disponible y la bandeja en memoria está llena. Descarga y limpia las capturas para continuar.');
      }
      const existingNames = new Set([...this.records.values()].map(({ info }) => info.filename));
      let occurrence = 1;
      let filename = captureFilename(options.videoName, timecode, format, occurrence);
      while (existingNames.has(filename)) filename = captureFilename(options.videoName, timecode, format, ++occurrence);
      thumbnailUrl = URL.createObjectURL(thumbnail);
      const info: Capture = {
        id, thumbnailUrl, time: options.time, timecode, size: blob.size, filename,
        width: options.width, height: options.height, format,
      };
      this.records.set(id, { info, onDisk, blob: onDisk ? undefined : blob });
      this.totalBytes += blob.size;
      if (!onDisk) this.memoryBytes += blob.size;
      return info;
    } catch (error) {
      if (writtenDirectory) await writtenDirectory.removeEntry(id).catch(() => undefined);
      if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
      throw error;
    } finally {
      releaseCanvas(canvas);
      this.capturing = false;
    }
  }

  async getBlob(id: string): Promise<Blob> {
    const record = this.records.get(id);
    if (!record) throw new Error('Esta captura ya no está en la bandeja.');
    if (record.blob) return record.blob;
    const directory = await this.directory();
    if (!directory) throw new Error('El almacenamiento local de capturas no está disponible.');
    const file = await directory.getFileHandle(id);
    return file.getFile();
  }

  async remove(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    if (record.onDisk) {
      const directory = await this.directory();
      if (directory) {
        try { await directory.removeEntry(id); } catch (error) {
          if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
        }
      }
    }
    // Another clear/remove may have completed while disk deletion was pending.
    if (!this.records.delete(id)) return;
    URL.revokeObjectURL(record.info.thumbnailUrl);
    this.totalBytes -= record.info.size;
    if (record.blob) this.memoryBytes -= record.info.size;
  }

  async clear(): Promise<void> {
    this.generation += 1;
    await Promise.all([...this.records.keys()].map((id) => this.remove(id)));
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.clear();
      if (this.directoryPromise) {
        await this.directoryPromise;
        await this.parentDirectory?.removeEntry(this.directoryName, { recursive: true }).catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
        });
      }
    } finally {
      this.releaseSessionLock?.();
      this.releaseSessionLock = undefined;
    }
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Browsers may consume the URL after the click handler returns.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadCapture(store: CaptureStore, capture: Capture): Promise<void> {
  downloadBlob(await store.getBlob(capture.id), capture.filename);
}

export async function copyFramePng(source: CanvasImageSource, width: number, height: number): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new Error('El portapapeles de imágenes no está disponible en este navegador. Descarga un PNG.');
  }
  // Passing a promise preserves the original user gesture in browsers such as Safari.
  const blob = captureImageBlob({ source, width, height, format: 'png' });
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** Two worker streams limit simultaneous full-frame reads and keep encoding off the UI thread. */
export async function createCaptureZip(
  store: Pick<CaptureStore, 'getBlob'>,
  captures: readonly Capture[],
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  if (!captures.length) throw new Error('Añade al menos una captura antes de descargar un ZIP.');
  if (captures.reduce((sum, capture) => sum + capture.size, 0) > MAX_ZIP_BYTES) {
    throw new Error('Este ZIP supera 256 MiB. Descarga una selección más pequeña para proteger la memoria.');
  }
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let outputBytes = 0;
    let failed = false;
    let complete = 0;
    const streams: AsyncZipDeflate[] = [];
    const archive = new Zip((error, data, final) => {
      if (failed) return;
      if (error) { fail(error); return; }
      outputBytes += data.length;
      if (outputBytes > MAX_ZIP_BYTES + 2 * MiB) { fail(new Error('El ZIP supera el límite de memoria.')); return; }
      chunks.push(new Uint8Array(data));
      if (final) {
        onProgress?.(1);
        resolve(new Blob(chunks, { type: 'application/zip' }));
      }
    });
    const fail = (error: unknown): void => {
      if (failed) return;
      failed = true;
      for (const stream of streams) stream.terminate();
      archive.terminate();
      chunks.length = 0;
      reject(error);
    };
    const addCapture = async (capture: Capture): Promise<void> => {
      const blob = await store.getBlob(capture.id);
      if (failed) return;
      const data = new Uint8Array(await blob.arrayBuffer());
      if (failed) return;
      // Image formats are already compressed. Level 0 avoids waste while still using a worker.
      const stream = new AsyncZipDeflate(capture.filename, { level: 0 });
      streams.push(stream);
      archive.add(stream);
      await new Promise<void>((finish, rejectFile) => {
        const ondata = stream.ondata;
        stream.ondata = (error, chunk, final) => {
          ondata(error, chunk, final);
          if (error) rejectFile(error);
          else if (final) finish();
        };
        stream.push(data, true);
      });
      complete += 1;
      onProgress?.(complete / captures.length);
    };
    void (async () => {
      onProgress?.(0);
      for (let offset = 0; offset < captures.length && !failed; offset += 2) {
        await Promise.all(captures.slice(offset, offset + 2).map(addCapture));
      }
      if (!failed) archive.end();
    })().catch(fail);
  });
}

export async function downloadZip(
  store: CaptureStore,
  captures: readonly Capture[],
  onProgress?: (progress: number) => void,
): Promise<void> {
  const filename = captures[0]?.filename.replace(/_\d{2,}-\d{2}-\d{2}-\d{2,}(?:_\d+)?\.[^.]+$/, '') ?? 'pixelframe';
  downloadBlob(await createCaptureZip(store, captures, onProgress), `${filename}_frames.zip`);
}
