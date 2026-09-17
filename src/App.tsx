import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowsOutSimpleIcon } from '@phosphor-icons/react/dist/csr/ArrowsOutSimple';
import { CameraIcon } from '@phosphor-icons/react/dist/csr/Camera';
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CaretLineLeftIcon } from '@phosphor-icons/react/dist/csr/CaretLineLeft';
import { CaretLineRightIcon } from '@phosphor-icons/react/dist/csr/CaretLineRight';
import { CaretUpIcon } from '@phosphor-icons/react/dist/csr/CaretUp';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { CircleNotchIcon } from '@phosphor-icons/react/dist/csr/CircleNotch';
import { ClipboardIcon } from '@phosphor-icons/react/dist/csr/Clipboard';
import { CornersOutIcon } from '@phosphor-icons/react/dist/csr/CornersOut';
import { CursorIcon } from '@phosphor-icons/react/dist/csr/Cursor';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/csr/DownloadSimple';
import { FilmStripIcon } from '@phosphor-icons/react/dist/csr/FilmStrip';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/csr/FolderOpen';
import { FrameCornersIcon } from '@phosphor-icons/react/dist/csr/FrameCorners';
import { HandIcon } from '@phosphor-icons/react/dist/csr/Hand';
import { ImageIcon } from '@phosphor-icons/react/dist/csr/Image';
import { KeyboardIcon } from '@phosphor-icons/react/dist/csr/Keyboard';
import { LayoutIcon } from '@phosphor-icons/react/dist/csr/Layout';
import { LockSimpleIcon } from '@phosphor-icons/react/dist/csr/LockSimple';
import { MagnifyingGlassMinusIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlassMinus';
import { MagnifyingGlassPlusIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlassPlus';
import { PauseIcon } from '@phosphor-icons/react/dist/csr/Pause';
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { QuestionIcon } from '@phosphor-icons/react/dist/csr/Question';
import { ScanIcon } from '@phosphor-icons/react/dist/csr/Scan';
import { ShieldCheckIcon } from '@phosphor-icons/react/dist/csr/ShieldCheck';
import { SidebarSimpleIcon } from '@phosphor-icons/react/dist/csr/SidebarSimple';
import { SkipBackIcon } from '@phosphor-icons/react/dist/csr/SkipBack';
import { SkipForwardIcon } from '@phosphor-icons/react/dist/csr/SkipForward';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/csr/SlidersHorizontal';
import { StackSimpleIcon } from '@phosphor-icons/react/dist/csr/StackSimple';
import { TrashSimpleIcon } from '@phosphor-icons/react/dist/csr/TrashSimple';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { AnimatedDialog } from './components/AnimatedDialog';
import { Dropdown } from './components/Dropdown';
import { useVideoZoom, VIDEO_ZOOM_LEVELS } from './hooks/useVideoZoom';
import { useWorkspaceLayout } from './hooks/useWorkspaceLayout';
import type { WorkspaceLayoutMode } from './hooks/useWorkspaceLayout';
import { useWorkspacePanels } from './hooks/useWorkspacePanels';
import { openMedia } from './lib/media';
import type { DecodedFrame, MediaSession } from './lib/media';
import { CaptureStore, captureFilename, captureMetadataBlob, captureTimecode, captureImageBlob, copyFramePng, createContactSheet, downloadBlob, downloadCapture, downloadZip, sanitizeVideoName } from './lib/captures';
import type { Capture, CaptureFormat } from './lib/captures';
import { formatTimecode, parseTimecode } from './lib/timecode';

const shortcuts = [['Espacio', 'Reproducir / pausar'], ['←  →', 'Fotograma anterior / siguiente'], ['Shift + ← / →', 'Retroceder / avanzar 1 segundo'], ['J / K / L', 'Reversa / pausa / avance (1×, 2×, 4×)'], ['C / Enter', 'Añadir captura a la bandeja'], ['⌘ / Ctrl + C', 'Copiar fotograma como PNG'], ['I / O', 'Marcar entrada / salida'], ['Home / End', 'Primer / último fotograma'], ['+ / − / 0', 'Acercar / alejar / ajustar al visor'], ['Ctrl / ⌘ + rueda', 'Zoom sobre el punto del cursor']];
const bytes = (value: number) => value < 1024 * 1024 ? `${(value / 1024).toFixed(0)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
const durationLabel = (time: number) => `${Math.floor(Math.max(0, time) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, time) % 60).toString().padStart(2, '0')}`;
const timeLabel = (time: number, fps: number | null) => fps ? formatTimecode(Math.max(0, time), fps) : `${Math.max(0, time).toFixed(3)} s`;
function waitForFrame(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const done = () => { window.clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = window.setTimeout(done, delay);
    signal.addEventListener('abort', done, { once: true });
    if (signal.aborted) done();
  });
}
const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';
function sceneSignature(source: CanvasImageSource): Float32Array {
  const canvas = document.createElement('canvas');
  canvas.width = 32; canvas.height = 18;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No se pudo analizar los cambios de escena.');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const signature = new Float32Array(canvas.width * canvas.height);
  for (let index = 0; index < signature.length; index++) {
    const offset = index * 4;
    signature[index] = (data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722) / 255;
  }
  return signature;
}
function sceneDifference(previous: Float32Array, next: Float32Array): number {
  let difference = 0;
  for (let index = 0; index < previous.length; index++) difference += Math.abs(previous[index] - next[index]);
  return difference / previous.length;
}
function IconButton({ label, children, active = false, ...props }: { label: string; children: ReactNode; active?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`icon-button${active ? ' active' : ''}`} aria-label={label} title={label} {...props}>{children}</button>;
}
function App() {
  const [session, setSession] = useState<MediaSession | null>(null);
  const sessionRef = useRef<MediaSession | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [captureStore] = useState(() => new CaptureStore({ maxBytes: 256 * 1024 * 1024 }));
  const store = useRef(captureStore);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [time, setTime] = useState(0);
  const currentFrame = useRef<DecodedFrame | null>(null);
  const [timeInput, setTimeInput] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const playback = useRef<AbortController | null>(null);
  const seekController = useRef<AbortController | null>(null);
  const stepQueue = useRef<Promise<void>>(Promise.resolve());
  const stepEpoch = useRef(0);
  const pendingSteps = useRef(0);
  const jogPosition = useRef<number | null>(null);
  const thumbnailsController = useRef<AbortController | null>(null);
  const loadGeneration = useRef(0);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const thumbnailUrls = useRef<string[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [format, setFormat] = useState<CaptureFormat>('png');
  const [quality, setQuality] = useState(95);
  const [exportName, setExportName] = useState('');
  const [panel, setPanel] = useState<'frame' | 'range'>('frame');
  const [rangeIn, setRangeIn] = useState<number | null>(null);
  const [rangeOut, setRangeOut] = useState<number | null>(null);
  const [interval, setIntervalValue] = useState(1);
  const [rangeMode, setRangeMode] = useState<'interval' | 'all' | 'timecodes' | 'scenes'>('interval');
  const [timecodesText, setTimecodesText] = useState('');
  const [sceneSample, setSceneSample] = useState(1);
  const [sceneThreshold, setSceneThreshold] = useState(0.24);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const batchController = useRef<AbortController | null>(null);
  const [flash, setFlash] = useState(false);
  const meta = session?.metadata;
  const workspaceLayout = useWorkspaceLayout(meta?.width ?? 0, meta?.height ?? 0);
  const panels = useWorkspacePanels(workspaceLayout.resolved);
  const { inspectorVisible, inspectorWidth, trayVisible, trayHeight, trayOpen, setTrayOpen } = panels;
  const [help, setHelp] = useState(false);
  const [preview, setPreview] = useState<{ capture: Capture; url: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [comparisonFirst, setComparisonFirst] = useState<{ capture: Capture; url: string } | null>(null);
  const [comparison, setComparison] = useState<{ left: { capture: Capture; url: string }; right: { capture: Capture; url: string } } | null>(null);
  const [comparisonSplit, setComparisonSplit] = useState(50);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [offlineReady, setOfflineReady] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const videoZoom = useVideoZoom(meta?.width ?? 0, meta?.height ?? 0, !!session && !loading);
  const isPortraitLayout = workspaceLayout.resolved === 'portrait';
  const sidebarVisible = inspectorVisible || (isPortraitLayout && trayVisible);
  const fps = meta?.fps ?? null;
  const duration = meta?.duration ?? 0;
  const start = meta?.startTime ?? 0;
  const span = duration - start;
  const position = span > 0 ? (time - start) / span * 100 : 0;
  const disabled = !session || loading || !!busy;
  const canCapture = !disabled && !seeking && !!currentFrame.current;
  const totalBytes = captures.reduce((sum, capture) => sum + capture.size, 0);
  const rangeStart = rangeIn ?? start;
  const rangeEnd = rangeOut ?? duration;
  const parsedTimecodes = timecodesText.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean).map(value => fps ? parseTimecode(value, fps) : Number(value.replace(/\s*s$/, ''))).filter((value): value is number => value !== null && Number.isFinite(value) && value >= start && value < duration);
  const uniqueTimecodes = [...new Set(parsedTimecodes.map(value => Number(value.toFixed(6))))].sort((a, b) => a - b);
  const rangeCount = rangeMode === 'interval' && interval > 0 ? Math.ceil(Math.max(0, rangeEnd - rangeStart) / interval)
    : rangeMode === 'all' ? Math.ceil(Math.max(0, Math.min(rangeEnd, rangeStart + 1) - rangeStart) * (fps ?? 30))
      : rangeMode === 'timecodes' ? uniqueTimecodes.length
        : sceneSample > 0 ? Math.min(500, Math.ceil(Math.max(0, rangeEnd - rangeStart) / sceneSample)) : 0;

  function notify(text: string, error = false) { setNotice({ text, error }); }
  function report(error: unknown) { if (!isAbort(error)) notify(error instanceof Error ? error.message : 'No se pudo completar la operación.', true); }
  function draw(frame: DecodedFrame) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== frame.canvas.width) canvas.width = frame.canvas.width;
    if (canvas.height !== frame.canvas.height) canvas.height = frame.canvas.height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('No se pudo iniciar el visor.');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(frame.canvas, 0, 0);
    currentFrame.current = frame;
    setTime(frame.time);
  }
  function stop() {
    playback.current?.abort();
    playback.current = null;
    setPlaying(false);
  }
  async function seek(target: number, direction?: -1 | 1) {
    const active = sessionRef.current;
    if (!active || busyRef.current || loading) return;
    stop();
    if (direction) {
      const epoch = stepEpoch.current;
      pendingSteps.current++;
      setSeeking(true);
      stepQueue.current = stepQueue.current.then(async () => {
        if (epoch !== stepEpoch.current || active !== sessionRef.current || busyRef.current) return;
        seekController.current?.abort();
        const controller = new AbortController();
        seekController.current = controller;
        try {
          const frame = await active.getAdjacentFrame(currentFrame.current?.time ?? target, direction, controller.signal);
          if (!controller.signal.aborted && epoch === stepEpoch.current) draw(frame);
        } catch (error) { report(error); }
        finally { if (seekController.current === controller) seekController.current = null; }
      }).finally(() => {
        pendingSteps.current--;
        if (pendingSteps.current === 0 && !seekController.current) setSeeking(false);
      });
      await stepQueue.current;
      return;
    }
    stepEpoch.current++;
    seekController.current?.abort();
    const controller = new AbortController();
    seekController.current = controller;
    setSeeking(true);
    try {
      const frame = await active.getFrame(Math.max(start, Math.min(duration - 0.000001, target)), controller.signal);
      if (!controller.signal.aborted && active === sessionRef.current) draw(frame);
    } catch (error) { report(error); }
    finally { if (seekController.current === controller) { setSeeking(false); seekController.current = null; } }
  }
  async function play(speed = 1) {
    const active = sessionRef.current;
    if (!active || busyRef.current || loading) return;
    stop();
    stepEpoch.current++;
    seekController.current?.abort();
    setSeeking(false);
    const controller = new AbortController();
    playback.current = controller;
    setPlaying(true);
    setRate(speed);
    try {
      let from = currentFrame.current?.time ?? active.metadata.startTime;
      if (speed > 0 && from + (currentFrame.current?.duration ?? 0) >= duration - 0.00001) from = start;
      if (speed < 0) {
        while (!controller.signal.aborted) {
          const frame = await active.getAdjacentFrame(from, -1, controller.signal);
          if (controller.signal.aborted) break;
          draw(frame);
          if (frame.time >= from || frame.time <= start) break;
          from = frame.time;
          await waitForFrame(Math.max(8, frame.duration * 1000 / Math.abs(speed)), controller.signal);
        }
      } else {
        const clockStart = performance.now();
        for await (const frame of active.frames(from, duration, controller.signal)) {
          const delay = (frame.time - from) * 1000 / speed - (performance.now() - clockStart);
          if (delay > 0) await waitForFrame(delay, controller.signal);
          if (controller.signal.aborted) break;
          draw(frame);
        }
      }
    } catch (error) { report(error); }
    finally { if (playback.current === controller) { playback.current = null; setPlaying(false); } }
  }
  async function loadFile(file: File) {
    if (busyRef.current || loading) return;
    const generation = ++loadGeneration.current;
    stepEpoch.current++;
    stop();
    seekController.current?.abort();
    thumbnailsController.current?.abort();
    setLoading(true);
    setNotice(null);
    let next: MediaSession | null = null;
    try {
      next = await openMedia(file);
      const first = await next.getFrame(next.metadata.startTime);
      if (generation !== loadGeneration.current) { next.close(); return; }
      sessionRef.current?.close();
      sessionRef.current = next;
      setSession(next);
      setExportName(file.name);
      setRangeIn(null); setRangeOut(null); setTimeInput(null); videoZoom.reset();
      draw(first);
      thumbnailUrls.current.forEach(URL.revokeObjectURL);
      thumbnailUrls.current = [];
      setThumbnails([]);
      if (next.metadata.hdr) notify('Fuente HDR: el navegador convierte la imagen al espacio de color del canvas. La exportación no conserva el HDR original.');
      void generateThumbnails(next);
    } catch (error) { next?.close(); report(error); }
    finally { setLoading(false); setSeeking(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function generateThumbnails(active: MediaSession) {
    const controller = new AbortController();
    thumbnailsController.current = controller;
    const urls: string[] = [];
    try {
      const count = active.metadata.engine === 'ffmpeg' ? 6 : 12;
      for (let index = 0; index < count; index++) {
        const at = active.metadata.startTime + (active.metadata.duration - active.metadata.startTime) * index / count;
        const frame = await active.getThumbnail(at, controller.signal);
        const blob = await captureImageBlob({ source: frame.canvas, width: frame.canvas.width, height: frame.canvas.height, format: 'jpeg', quality: 0.6 });
        if (controller.signal.aborted || sessionRef.current !== active) break;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        thumbnailUrls.current = [...urls];
        setThumbnails([...urls]);
        await new Promise(resolve => window.setTimeout(resolve, 80));
      }
    } catch (error) { if (!isAbort(error)) console.warn('Miniaturas no disponibles', error); }
  }
  function captureOptions(frame: DecodedFrame) {
    return { source: frame.canvas, width: frame.canvas.width, height: frame.canvas.height, time: Math.max(0, frame.time), fps, videoName: exportName || meta?.name || 'video', format, quality: quality / 100 };
  }
  async function capture() {
    const frame = currentFrame.current;
    if (!frame || busyRef.current || seeking || loading) return;
    busyRef.current = true;
    setBusy('Capturando'); setFlash(true);
    window.setTimeout(() => setFlash(false), 150);
    try {
      const item = await store.current.capture(captureOptions(frame));
      setCaptures(items => [...items, item]);
      setTrayOpen(true);
      notify('Fotograma añadido a la bandeja.');
    } catch (error) { report(error); }
    finally { busyRef.current = false; setBusy(null); }
  }
  async function downloadCurrent() {
    const frame = currentFrame.current;
    if (!frame || busyRef.current || seeking || loading) return;
    busyRef.current = true; setBusy('Exportando');
    try {
      const blob = await captureImageBlob(captureOptions(frame));
      downloadBlob(blob, captureFilename(exportName || meta?.name || 'video', captureTimecode(Math.max(0, frame.time), fps), format));
      notify('Fotograma exportado a resolución nativa.');
    } catch (error) { report(error); }
    finally { busyRef.current = false; setBusy(null); }
  }
  async function copyCurrent() {
    const frame = currentFrame.current;
    if (!frame || busyRef.current || seeking || loading) return;
    try { await copyFramePng(frame.canvas, frame.canvas.width, frame.canvas.height); notify('Fotograma PNG copiado al portapapeles.'); }
    catch (error) { report(error); }
  }
  async function exportZip() {
    if (!captures.length || busyRef.current) return;
    busyRef.current = true; setBusy('Preparando ZIP'); setProgress(0);
    try { await downloadZip(store.current, captures, setProgress); notify(`${captures.length} fotogramas exportados en ZIP.`); }
    catch (error) { report(error); }
    finally { busyRef.current = false; setBusy(null); }
  }
  async function exportMetadata(format: 'json' | 'csv') {
    if (!captures.length || busyRef.current) return;
    const base = sanitizeVideoName(exportName || meta?.name || 'pixelframe');
    downloadBlob(captureMetadataBlob(captures, format), `${base}_capturas.${format}`);
    notify(`Metadatos de ${captures.length} capturas exportados como ${format.toUpperCase()}.`);
  }
  async function exportContactSheet() {
    if (!captures.length || busyRef.current) return;
    busyRef.current = true; setBusy('Creando hoja de contactos');
    try {
      const blob = await createContactSheet(store.current, captures);
      downloadBlob(blob, `${sanitizeVideoName(exportName || meta?.name || 'pixelframe')}_contactos.png`);
      notify('Hoja de contactos PNG exportada.');
    } catch (error) { report(error); }
    finally { busyRef.current = false; setBusy(null); }
  }
  async function removeCapture(item: Capture) {
    if (busyRef.current) return;
    try { await store.current.remove(item.id); setCaptures(items => items.filter(c => c.id !== item.id)); }
    catch (error) { report(error); }
  }
  async function clearCaptures() {
    if (busyRef.current) return;
    try { await store.current.clear(); setCaptures([]); }
    catch (error) { report(error); }
  }
  async function showPreview(item: Capture) {
    try { const blob = await store.current.getBlob(item.id); setPreview({ capture: item, url: URL.createObjectURL(blob) }); setPreviewOpen(true); }
    catch (error) { report(error); }
  }
  async function compareCapture(item: Capture) {
    try {
      const selected = { capture: item, url: URL.createObjectURL(await store.current.getBlob(item.id)) };
      setPreviewOpen(false);
      if (!comparisonFirst) { setComparisonFirst(selected); notify('Primera captura elegida. Selecciona otra para compararlas.'); return; }
      setComparison({ left: comparisonFirst, right: selected });
      setComparisonFirst(null); setComparisonSplit(50);
    } catch (error) { report(error); }
  }
  function mark(point: 'in' | 'out') {
    if (!session || busyRef.current) return;
    if (point === 'in') { setRangeIn(time); if (rangeOut !== null && time >= rangeOut) setRangeOut(null); }
    else { setRangeOut(Math.min(duration, time + (currentFrame.current?.duration ?? 0))); if (rangeIn !== null && time < rangeIn) setRangeIn(null); }
    setPanel('range');
  }
  async function extractRange() {
    const active = sessionRef.current;
    if (!active || busyRef.current) return;
    if (!(rangeEnd > rangeStart)) { notify('Elige un rango válido.', true); return; }
    if (rangeMode === 'interval' && (!Number.isFinite(interval) || interval <= 0)) { notify('Elige un intervalo mayor que cero.', true); return; }
    if (rangeMode === 'timecodes' && (!uniqueTimecodes.length || uniqueTimecodes.length !== timecodesText.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean).length)) { notify('Revisa los timecodes: usa uno por línea o separado por comas, dentro de la duración.', true); return; }
    if (rangeMode === 'scenes' && (!Number.isFinite(sceneSample) || sceneSample <= 0 || !Number.isFinite(sceneThreshold) || sceneThreshold <= 0 || sceneThreshold > 1)) { notify('Elige valores válidos para el análisis de escenas.', true); return; }
    if (rangeCount + captures.length > 500) { notify('La bandeja admite 500 capturas. Aumenta el intervalo o reduce el rango.', true); return; }
    stop(); seekController.current?.abort(); thumbnailsController.current?.abort();
    const controller = new AbortController(); batchController.current = controller;
    busyRef.current = true; setBusy('Extrayendo rango'); setProgress(0);
    let count = 0;
    const add = async (frame: DecodedFrame) => {
      if (controller.signal.aborted) throw new DOMException('Cancelado', 'AbortError');
      const item = await store.current.capture(captureOptions(frame));
      count++; setCaptures(items => [...items, item]); setProgress(Math.min(1, count / Math.max(1, rangeCount)));
    };
    try {
      setTrayOpen(true);
      if (rangeMode === 'all') {
        for await (const frame of active.frames(rangeStart, Math.min(rangeEnd, rangeStart + 1), controller.signal)) await add(frame);
      } else if (rangeMode === 'interval') {
        let previousTime = -Infinity;
        for (let index = 0; index < rangeCount; index++) {
          const frame = await active.getFrame(rangeStart + index * interval, controller.signal);
          if (frame.time !== previousTime) { await add(frame); previousTime = frame.time; }
        }
      } else if (rangeMode === 'timecodes') {
        let previousTime = -Infinity;
        for (const target of uniqueTimecodes) {
          const frame = await active.getFrame(target, controller.signal);
          if (frame.time !== previousTime) { await add(frame); previousTime = frame.time; }
        }
      } else {
        let previous: Float32Array | null = null;
        let previousTime = -Infinity;
        for (let index = 0; index < rangeCount; index++) {
          const frame = await active.getFrame(rangeStart + index * sceneSample, controller.signal);
          const signature = sceneSignature(frame.canvas);
          if (frame.time !== previousTime && (!previous || sceneDifference(previous, signature) >= sceneThreshold)) await add(frame);
          previous = signature;
          previousTime = frame.time;
          setProgress((index + 1) / Math.max(1, rangeCount));
        }
      }
      notify(`${count} fotogramas añadidos a la bandeja.`);
    } catch (error) { if (isAbort(error)) notify(`Extracción cancelada. Se conservaron ${count} capturas.`); else report(error); }
    finally { busyRef.current = false; setBusy(null); batchController.current = null; }
  }
  function jumpTimecode() {
    if (timeInput === null) return;
    const target = fps ? parseTimecode(timeInput, fps) : Number(timeInput.replace(/\s*s$/, ''));
    if (target === null || !Number.isFinite(target) || target < start || target >= duration) notify('Código de tiempo inválido o fuera de la duración del video.', true);
    else void seek(target);
    setTimeInput(null);
  }
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.ready.then(() => setOfflineReady(true));
  }, []);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), notice.error ? 9000 : 4000); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => { return () => { if (preview) URL.revokeObjectURL(preview.url); }; }, [preview]);
  useEffect(() => () => { if (comparison) { URL.revokeObjectURL(comparison.left.url); URL.revokeObjectURL(comparison.right.url); } }, [comparison]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || target.closest('[role=combobox], [role=listbox], [role=option], dialog')) return;
      if (event.key === 'Escape') { setHelp(false); setPreviewOpen(false); setComparison(null); setComparisonFirst(null); batchController.current?.abort(); return; }
      if (target.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
      if (target.closest('button,a') && ['Enter', ' '].includes(event.key)) return;
      if (event.key === '?') { event.preventDefault(); setHelp(value => !value); return; }
      if (help || preview || comparison || disabled || target.closest('[role=separator]')) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'c') { event.preventDefault(); void copyCurrent(); return; }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (['+', '=', '-', '0'].includes(key)) {
        event.preventDefault();
        if (key === '0') videoZoom.reset();
        else if (key === '-') videoZoom.zoomOut();
        else videoZoom.zoomIn();
        return;
      }
      if ([' ', 'arrowleft', 'arrowright', 'home', 'end', 'j', 'k', 'l', 'c', 'enter', 'i', 'o'].includes(key)) event.preventDefault();
      if (key === ' ') playing ? stop() : void play();
      if (key === 'k') stop();
      if (key === 'j') void play(playing && rate < 0 ? Math.max(-4, rate * 2) : -1);
      if (key === 'l') void play(playing && rate > 0 ? Math.min(4, rate * 2) : 1);
      if (key === 'arrowleft' || key === 'arrowright') { const direction = key === 'arrowleft' ? -1 : 1; if (event.shiftKey) void seek(time + direction); else void seek(currentFrame.current?.time ?? time, direction); }
      if (key === 'home') void seek(start);
      if (key === 'end') void seek(duration - 0.000001);
      if ((key === 'c' || key === 'enter') && !event.repeat) void capture();
      if (key === 'i') mark('in');
      if (key === 'o') mark('out');
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });
  useEffect(() => {
    const activeStore = store.current;
    return () => { loadGeneration.current++; playback.current?.abort(); seekController.current?.abort(); thumbnailsController.current?.abort(); batchController.current?.abort(); sessionRef.current?.close(); thumbnailUrls.current.forEach(URL.revokeObjectURL); void activeStore.dispose().catch(() => {}); };
  }, []);

  return <div className="app" onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDragLeave={() => { dragDepth.current--; if (dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); const file = event.dataTransfer.files[0]; if (file) void loadFile(file); }}>
    <input ref={fileInput} type="file" accept="video/*,.mkv,.avi,.mov,.mxf,.m4v" className="file-input" aria-label="Seleccionar video local" onChange={event => { const file = event.target.files?.[0]; if (file) void loadFile(file); }} />
    <header className="app-header">
      <a className="brand" href="#" aria-label="PixelFrame inicio" onClick={event => event.preventDefault()}><span className="brand-symbol"><FrameCornersIcon size={23}/><i/></span><span>Pixel<span className="brand-light">Frame</span></span><span className="version">BETA</span></a>
      <div className="header-divider"/><div className="layout-chooser"><LayoutIcon size={16}/><label htmlFor="workspace-layout">Layout</label><Dropdown id="workspace-layout" label="Layout del espacio de trabajo" value={workspaceLayout.mode} onValueChange={value => { workspaceLayout.setMode(value as WorkspaceLayoutMode); videoZoom.reset(); }} options={[
        { value: 'auto', label: `Automático${meta ? ` · ${workspaceLayout.shape === 'portrait' ? 'Vertical' : 'Horizontal'}` : ''}` },
        { value: 'landscape', label: 'Horizontal' }, { value: 'portrait', label: 'Vertical' }, { value: 'focus', label: 'Visor grande' },
      ]}/></div>
      <div className="header-right"><span className="local-badge"><ShieldCheckIcon size={15}/>{offlineReady ? 'Disponible sin conexión' : '100% local'}</span><div className="panel-toggles" aria-label="Mostrar u ocultar paneles"><IconButton label={inspectorVisible ? 'Ocultar panel de extracción' : 'Mostrar panel de extracción'} active={inspectorVisible} aria-pressed={inspectorVisible} onClick={() => panels.toggle('inspector')}><SidebarSimpleIcon size={18} mirrored/></IconButton><IconButton label={trayVisible ? 'Ocultar bandeja de capturas' : 'Mostrar bandeja de capturas'} active={trayVisible} aria-pressed={trayVisible} onClick={() => panels.toggle('tray')}><SidebarSimpleIcon size={18} className="tray-panel-icon"/></IconButton></div><IconButton label="Atajos de teclado (?)" onClick={() => setHelp(true)}><KeyboardIcon size={19}/></IconButton><button className="button open-button" disabled={loading || !!busy} onClick={() => fileInput.current?.click()}><FolderOpenIcon size={16}/>Abrir video</button></div>
    </header>
    <main className={`workspace layout-${workspaceLayout.resolved} ${panels.resizing ? `resizing resizing-${panels.resizing}` : ''} ${inspectorVisible ? '' : 'inspector-hidden'} ${trayVisible ? '' : 'tray-hidden'}`} data-layout={workspaceLayout.resolved} data-layout-mode={workspaceLayout.mode} data-video-shape={workspaceLayout.shape} style={{ '--video-ratio': meta ? meta.width / meta.height : 16 / 9, '--inspector-width': `${sidebarVisible ? inspectorWidth : 0}px`, '--tray-body-height': `${trayVisible && trayOpen ? trayHeight : 0}px`, '--tray-header-height': trayVisible ? '53px' : '0px' } as CSSProperties}>
      {sidebarVisible && <div className="resize-handle resize-inspector" {...panels.separatorProps('inspector')}><span/></div>}
      {trayVisible && trayOpen && (!isPortraitLayout || inspectorVisible) && <div className="resize-handle resize-tray" {...panels.separatorProps('tray')}><span/></div>}
      <section className="editor" aria-label="Visor de video">
        <div className="monitor-toolbar"><div className="source-label"><FilmStripIcon size={15}/><span>{meta?.name ?? 'Sin archivo seleccionado'}</span>{meta && <span className="codec-badge">{meta.codec}</span>}</div><div className="monitor-options"><div className="video-zoom-controls" role="group" aria-label="Controles de zoom"><IconButton label="Alejar video" disabled={!videoZoom.canZoomOut} onClick={videoZoom.zoomOut}><MagnifyingGlassMinusIcon size={15}/></IconButton><Dropdown label="Zoom del visor" value={videoZoom.value} disabled={!session || loading} onValueChange={videoZoom.select} options={[
          { value: 'fit', label: `Ajustar${session ? ` (${videoZoom.percent}%)` : ''}` },
          ...VIDEO_ZOOM_LEVELS.map(value => ({ value: String(value), label: `${value}%` })),
          ...(videoZoom.value !== 'fit' && !VIDEO_ZOOM_LEVELS.includes(Number(videoZoom.value)) ? [{ value: videoZoom.value, label: `${videoZoom.value}%` }] : []),
        ]}/><IconButton label="Acercar video" disabled={!videoZoom.canZoomIn} onClick={videoZoom.zoomIn}><MagnifyingGlassPlusIcon size={15}/></IconButton><IconButton label="Ajustar video al visor" disabled={!session || loading} active={videoZoom.value === 'fit' && !!session} onClick={videoZoom.reset}><ScanIcon size={15}/></IconButton></div><IconButton label="Pantalla completa" disabled={!session} onClick={() => { const monitor = document.querySelector('.monitor'); if (document.fullscreenElement) void document.exitFullscreen(); else void monitor?.requestFullscreen().catch(report); }}><CornersOutIcon size={15}/></IconButton></div></div>
        <div className={`monitor ${session ? 'has-video' : ''}`}>
          <div ref={videoZoom.viewportRef} className={`video-viewport ${videoZoom.canPan ? 'can-pan' : ''} ${videoZoom.dragging ? 'panning' : ''} ${videoZoom.interacting ? 'interacting' : ''}`} data-zoom-scale={videoZoom.scale} data-pan-x={videoZoom.pan.x} data-pan-y={videoZoom.pan.y} {...videoZoom.pointerHandlers} aria-label="Visor con zoom; arrastra para desplazar la imagen ampliada">
            <canvas ref={canvasRef} className="video-canvas" aria-label="Fotograma actual a resolución nativa" style={{ display: session ? 'block' : 'none', width: meta?.width ?? 0, height: meta?.height ?? 0, transform: `translate(-50%, -50%) translate(${videoZoom.pan.x}px, ${videoZoom.pan.y}px) scale(${videoZoom.scale})` }} />
          </div>
          {!session && !loading && <div className="import-state"><div className="import-frame"><div className="import-icon"><FilmStripIcon size={30}/><span><PlusIcon size={12}/></span></div></div><h1>Encuentra el fotograma perfecto.</h1><p>Arrastra un video aquí para comenzar.</p><button className="button primary import-button" onClick={() => fileInput.current?.click()}><FolderOpenIcon size={17}/>Seleccionar video<span>↗</span></button><div className="format-hints">MP4<span/>MOV<span/>WebM<span/>MKV<span/>AVI</div><div className="import-privacy"><LockSimpleIcon size={13}/>Tu video nunca sale de este dispositivo.</div></div>}
          {session && <><div className="monitor-corner"><span className="live-square"/>{meta?.width} × {meta?.height}<span className="separator">/</span>{meta?.aspectRatio}</div><div className="osd mono">{timeLabel(time, fps)}</div><div className="frame-pixel-note"><ScanIcon size={13}/>RESOLUCIÓN NATIVA</div>{videoZoom.canPan && <div className="zoom-pan-hint"><HandIcon size={13}/><span>Arrastra para explorar</span><strong className="mono">{videoZoom.percent}%</strong></div>}</>}
          {loading && <div className="loading-overlay"><CircleNotchIcon className="spin" size={25}/><strong>Leyendo tu video…</strong><span>Procesando el archivo en este dispositivo.</span></div>}
          {flash && <div className="shutter-flash"/>}
        </div>
        <div className="transport">
          <div className="timecode-block"><input aria-label={fps ? 'Código de tiempo SMPTE' : 'Tiempo en segundos'} className="timecode-input mono" disabled={disabled} value={timeInput ?? timeLabel(time, fps ?? (session ? null : 30))} onFocus={() => setTimeInput(fps ? timeLabel(time, fps) : time.toFixed(3))} onChange={event => setTimeInput(event.target.value)} onBlur={jumpTimecode} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') setTimeInput(null); }}/><span className="timecode-mode">{fps ? 'NDF' : session ? 'PTS' : 'TIMECODE'}<span className="timecode-total"> / {durationLabel(duration)}</span></span></div>
          <div className="transport-controls"><IconButton label="Ir al inicio (Home)" disabled={disabled} onClick={() => void seek(start)}><SkipBackIcon size={17}/></IconButton><IconButton label="Fotograma anterior (←)" disabled={disabled} onClick={() => void seek(currentFrame.current?.time ?? time, -1)}><CaretLineLeftIcon size={18}/></IconButton><button className="play-button" aria-label={playing ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'} disabled={disabled} onClick={() => playing ? stop() : void play()}>{playing ? <PauseIcon size={19}/> : <PlayIcon size={19}/>}</button><IconButton label="Fotograma siguiente (→)" disabled={disabled} onClick={() => void seek(currentFrame.current?.time ?? time, 1)}><CaretLineRightIcon size={18}/></IconButton><IconButton label="Ir al final (End)" disabled={disabled} onClick={() => void seek(duration - 0.000001)}><SkipForwardIcon size={17}/></IconButton><span className="playback-rate mono">{playing ? `${rate}×` : '1×'}</span><div className={`jog-wheel ${disabled ? 'disabled' : ''}`} role="slider" tabIndex={disabled ? -1 : 0} aria-label="Ajuste fino: arrastra para recorrer fotogramas" aria-valuemin={start} aria-valuemax={duration || 1} aria-valuenow={time} aria-valuetext={timeLabel(time, fps)} aria-disabled={disabled} title="Arrastra para recorrer fotogramas" onPointerDown={event => { if (disabled) return; event.currentTarget.setPointerCapture(event.pointerId); jogPosition.current = event.clientX; stop(); }} onPointerMove={event => { if (jogPosition.current === null || disabled) return; const steps = Math.trunc((event.clientX - jogPosition.current) / 8); if (!steps) return; jogPosition.current += steps * 8; for (let i = 0; i < Math.min(12, Math.abs(steps)); i++) void seek(currentFrame.current?.time ?? time, steps > 0 ? 1 : -1); }} onPointerUp={() => { jogPosition.current = null; }} onPointerCancel={() => { jogPosition.current = null; }}><i/></div></div>
          <button className="button primary capture-button" aria-label="Capturar fotograma" disabled={!canCapture} onClick={() => void capture()}><CameraIcon size={18}/><span>Capturar fotograma</span><kbd>C</kbd></button>
        </div>
        <div className="timeline-area">
          <div className="timeline-heading"><span><CursorIcon size={13}/>LÍNEA DE TIEMPO</span><div><button disabled={disabled} className={rangeIn !== null ? 'marker-button marked' : 'marker-button'} onClick={() => mark('in')}>Entrada <kbd>I</kbd></button><button disabled={disabled} className={rangeOut !== null ? 'marker-button marked' : 'marker-button'} onClick={() => mark('out')}>Salida <kbd>O</kbd></button></div></div>
          <div className="timeline-ruler">{Array.from({ length: 7 }, (_, index) => <span className="mono" key={index}>{span > 0 && span < 10 ? `${(start + span * index / 6).toFixed(1)} s` : durationLabel(start + span * index / 6)}</span>)}</div>
          <div className={`timeline ${session ? 'loaded' : ''}`} onMouseMove={event => { const rect = event.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))); }} onMouseLeave={() => setHover(null)}>
            <div className="filmstrip">{thumbnails.map((url, index) => <img key={url} src={url} alt={`Previsualización ${index + 1}`} draggable={false}/>)}{!thumbnails.length && Array.from({ length: 12 }, (_, index) => <div className="empty-film" key={index}/>)}</div>
            {(rangeIn !== null || rangeOut !== null) && <div className="range-highlight" style={{ left: `${(rangeStart - start) / span * 100}%`, width: `${(rangeEnd - rangeStart) / span * 100}%` }}/>}<div className="playhead" style={{ left: `${Math.min(99.9, position)}%` }}><span/></div>
            <input type="range" aria-label="Posición en la línea de tiempo" min={start} max={duration || 1} step="any" value={time} disabled={disabled} onChange={event => void seek(Number(event.target.value))}/>
            {hover !== null && session && <div className="scrub-preview" style={{ left: `${Math.max(8, Math.min(92, hover * 100))}%` }}>{thumbnails.length > 0 && <img src={thumbnails[Math.min(thumbnails.length - 1, Math.floor(hover * thumbnails.length))]} alt="Vista aproximada de este punto"/>}<span className="mono">{timeLabel(start + span * hover, fps)}</span><small>Vista aproximada</small></div>}
          </div>
          <div className="timeline-footer"><span>{meta ? `${meta.variableFrameRate ? 'FPS variable · ' : ''}${fps ? `${Number(fps.toFixed(3))} fps` : 'FPS no disponible'}` : 'Precisión de un fotograma'}</span><span><kbd>←</kbd><kbd>→</kbd> cuadro a cuadro <span className="footer-divider"/><kbd>Espacio</kbd> reproducir</span></div>
        </div>
      </section>
      <aside id="extraction-panel" className="inspector" aria-label="Ajustes de extracción" aria-hidden={!inspectorVisible} inert={!inspectorVisible}>
        <div className="inspector-header"><SlidersHorizontalIcon size={16}/><h2>Extracción</h2><IconButton label="Cerrar panel de extracción" onClick={() => panels.toggle('inspector')}><SidebarSimpleIcon size={16} mirrored/></IconButton></div>
        <div className="inspector-tabs" role="tablist" aria-label="Modo de extracción"><button role="tab" aria-selected={panel === 'frame'} className={panel === 'frame' ? 'selected' : ''} onClick={() => setPanel('frame')}><ImageIcon size={14}/>Fotograma</button><button role="tab" aria-selected={panel === 'range'} className={panel === 'range' ? 'selected' : ''} onClick={() => setPanel('range')}><StackSimpleIcon size={14}/>Por rango</button></div>
        <div className="inspector-content">
          <div className="setting-section"><div className="section-label">FORMATO DE IMAGEN</div><div className="format-selector">{(['png', 'jpeg', 'webp', 'tiff'] as const).map(item => <button key={item} disabled={!!busy} aria-pressed={format === item} className={format === item ? 'selected' : ''} onClick={() => setFormat(item)}>{item === 'jpeg' ? 'JPG' : item === 'tiff' ? 'TIFF' : item.toUpperCase()}</button>)}</div><div className="format-note">{format === 'png' || format === 'tiff' ? <><CheckIcon size={13}/>{format === 'tiff' ? 'TIFF RGBA sin compresión · ideal para archivo' : 'Sin pérdida · conserva la transparencia decodificada'}</> : <><SlidersHorizontalIcon size={13}/>Menor peso, calidad ajustable</>}</div>{format !== 'png' && format !== 'tiff' && <div className="quality-control"><label htmlFor="quality">Calidad <span className="mono">{quality}%</span></label><input id="quality" type="range" min="1" max="100" value={quality} disabled={!!busy} onChange={event => setQuality(Number(event.target.value))}/><div><span>Menor peso</span><span>Máxima calidad</span></div></div>}</div>
          <div className="setting-section"><div className="section-label">RESOLUCIÓN DE SALIDA <LockSimpleIcon size={12}/></div><div className="resolution-box"><span className="mono">{meta ? `${meta.width} × ${meta.height}` : '— × —'}</span><span className="native-tag">NATIVA</span></div><p className="setting-hint">Cada píxel, en su tamaño original.</p></div>
        {panel === 'range' && <div className="setting-section range-settings"><div className="section-label">RANGO DE EXTRACCIÓN<button disabled={disabled} onClick={() => { setRangeIn(null); setRangeOut(null); }}>Restablecer</button></div><div className="in-out"><button disabled={disabled} onClick={() => mark('in')}><span>ENTRADA <kbd>I</kbd></span><strong className="mono">{timeLabel(rangeStart, fps ?? (session ? null : 30))}</strong></button><button disabled={disabled} onClick={() => mark('out')}><span>SALIDA <kbd>O</kbd></span><strong className="mono">{timeLabel(rangeEnd, fps ?? (session ? null : 30))}</strong></button></div><label className="field-label" htmlFor="range-mode">Extraer</label><Dropdown id="range-mode" label="Extraer" value={rangeMode} disabled={!!busy} onValueChange={value => setRangeMode(value as 'interval' | 'all' | 'timecodes' | 'scenes')} options={[
            { value: 'interval', label: 'Un fotograma cada intervalo' }, { value: 'all', label: 'Todos los cuadros del primer segundo' },
            { value: 'timecodes', label: 'Lista de timecodes' }, { value: 'scenes', label: 'Detectar cambios de escena' },
          ]}/>{rangeMode === 'interval' && <div className="interval-input"><label htmlFor="interval">Intervalo</label><div><input id="interval" type="number" min="0.01" step="0.1" value={interval} disabled={!!busy} onChange={event => setIntervalValue(Number(event.target.value))}/><span>seg</span></div></div>}{rangeMode === 'timecodes' && <div className="timecodes-input"><label htmlFor="timecodes">Timecodes</label><textarea id="timecodes" value={timecodesText} disabled={!!busy} placeholder={fps ? '00:00:04:12\n00:00:11:08' : '4.500\n11.267'} onChange={event => setTimecodesText(event.target.value)}/><small>Uno por línea, o separados por coma.</small></div>}{rangeMode === 'scenes' && <div className="scene-inputs"><label>Muestrear cada <input aria-label="Muestrear escenas cada segundos" type="number" min="0.1" step="0.1" value={sceneSample} disabled={!!busy} onChange={event => setSceneSample(Number(event.target.value))}/> seg</label><label>Sensibilidad <input aria-label="Sensibilidad de escenas" type="number" min="0.01" max="1" step="0.01" value={sceneThreshold} disabled={!!busy} onChange={event => setSceneThreshold(Number(event.target.value))}/></label><small>Compara miniaturas de luminancia; una sensibilidad menor detecta más cortes.</small></div>}<p className="setting-hint">{session ? `${rangeMode === 'scenes' ? `hasta ${rangeCount}` : `≈ ${rangeCount}`} capturas · hasta 500 en la bandeja` : 'Marca entrada y salida en la línea de tiempo.'}</p></div>}
          <div className="setting-section filename-section"><label htmlFor="filename" className="section-label">NOMBRE DEL ARCHIVO</label><input id="filename" value={exportName} disabled={!session || !!busy} placeholder="Nombre del video" onChange={event => setExportName(event.target.value)}/><div className="filename-preview mono">{sanitizeVideoName(exportName || 'video')}_<span>{(fps ? timeLabel(time, fps) : '00:00:00:00').replaceAll(':', '-')}</span>.{format === 'jpeg' ? 'jpg' : format === 'tiff' ? 'tif' : format}</div></div>
          {panel === 'frame' ? <div className="quick-actions"><button className="button secondary wide" disabled={!canCapture} onClick={() => void downloadCurrent()}><DownloadSimpleIcon size={16}/>Descargar fotograma</button><button className="button subtle wide" disabled={!canCapture} onClick={() => void copyCurrent()}><ClipboardIcon size={15}/>Copiar al portapapeles<span className="shortcut-symbol">⌘ C</span></button></div> : <div className="quick-actions"><button className="button primary wide" disabled={disabled || rangeCount < 1 || !Number.isFinite(rangeCount)} onClick={() => void extractRange()}><StackSimpleIcon size={16}/>Extraer rango</button><p className="setting-hint centered">Las capturas se añadirán a la bandeja.</p></div>}
          <div className="source-info"><div className="section-label">ARCHIVO DE ORIGEN</div><dl><div><dt>Contenedor</dt><dd>{meta?.container ?? '—'}</dd></div><div><dt>Códec</dt><dd>{meta?.codec ?? '—'}</dd></div><div><dt>Frecuencia</dt><dd>{fps ? `${Number(fps.toFixed(3))} fps${meta?.variableFrameRate ? ' · VFR' : ''}` : '—'}</dd></div><div><dt>Duración</dt><dd className="mono">{meta ? durationLabel(span) : '—'}</dd></div><div><dt>Tamaño</dt><dd>{meta ? bytes(meta.size) : '—'}</dd></div></dl>{meta && <p className="setting-hint">{meta.fpsConfidence === 'sampled' ? 'FPS calculados a partir de marcas de tiempo.' : 'Metadatos del contenedor.'} {meta.variableFrameRate ? 'Timecode nominal; los pasos siguen los cuadros reales.' : ''}</p>}</div>
        </div>
        <div className="inspector-footer"><ShieldCheckIcon size={17}/><div><strong>Tu archivo se queda contigo.</strong><span>Sin subidas. Sin servidores de video.</span></div></div>
      </aside>
      <section id="capture-tray" className={`staging-tray ${trayOpen ? '' : 'collapsed'}`} aria-label="Bandeja de capturas" aria-hidden={!trayVisible} inert={!trayVisible}><div className="tray-header"><button className="tray-title" aria-expanded={trayOpen} onClick={() => setTrayOpen(value => !value)}><StackSimpleIcon size={17}/><h2>Capturas</h2><span className="count-badge">{captures.length}</span>{trayOpen ? <CaretDownIcon size={14}/> : <CaretUpIcon size={14}/>}</button><span className="tray-size">{captures.length ? `${bytes(totalBytes)} · resolución original` : 'Tu selección de fotogramas'}</span><div className="tray-actions">{captures.length > 0 && <div className="tray-export-tools"><button onClick={() => void exportContactSheet()} disabled={!!busy}>Contacto</button><button onClick={() => void exportMetadata('csv')} disabled={!!busy}>CSV</button><button onClick={() => void exportMetadata('json')} disabled={!!busy}>JSON</button></div>}<button className="text-button" aria-label="Vaciar" title="Vaciar capturas" disabled={!captures.length || !!busy} onClick={() => void clearCaptures()}><TrashSimpleIcon size={14}/><span>Vaciar</span></button><button className="button zip-button" aria-label="Descargar ZIP" disabled={!captures.length || !!busy} onClick={() => void exportZip()}><DownloadSimpleIcon size={15}/><span>Descargar ZIP</span>{captures.length > 0 && <span className="zip-count">{captures.length}</span>}</button></div></div><div className={`tray-body ${captures.length ? 'populated' : ''}`} aria-hidden={!trayOpen} inert={!trayOpen}>{captures.length ? captures.map((item, index) => <article className="capture-card" key={item.id}><div className="capture-thumbnail"><button onClick={() => void showPreview(item)} aria-label={`Previsualizar captura ${index + 1}`}><img src={item.thumbnailUrl} alt={`Fotograma ${item.timecode}`}/><span className="capture-index mono">{String(index + 1).padStart(2, '0')}</span><span className="capture-expand"><ArrowsOutSimpleIcon size={16}/></span></button><button className="delete-capture" aria-label={`Eliminar captura ${index + 1}`} disabled={!!busy} onClick={() => void removeCapture(item)}><XIcon size={14}/></button><button className="download-capture" aria-label={`Descargar captura ${index + 1}`} onClick={() => void downloadCapture(store.current, item).catch(report)}><DownloadSimpleIcon size={15}/></button></div><div className="capture-card-label"><span className="mono">{item.timecode}</span><span>{item.format === 'jpeg' ? 'JPG' : item.format === 'tiff' ? 'TIFF' : item.format.toUpperCase()}</span></div><div className="capture-card-meta"><span>{item.width} × {item.height}</span><span>{bytes(item.size)}</span></div></article>) : <div className="empty-tray"><span className="empty-tray-icon"><ImageIcon size={23}/><PlusIcon size={11}/></span><div><strong>Los buenos momentos van aquí.</strong><p>Encuentra un cuadro y pulsa <kbd>C</kbd> para guardarlo en tu bandeja.</p></div></div>}</div>
      </section>
    </main>
    <footer className="status-bar"><span><span className={`status-dot ${session ? 'ready' : ''}`}/>{loading ? 'Leyendo archivo local…' : busy ? `${busy}${progress > 0 ? ` · ${Math.round(progress * 100)}%` : '…'}` : seeking ? 'Buscando fotograma…' : session ? 'Listo para capturar' : 'Esperando un video'}</span><span className="status-engine">{meta ? `${meta.engine === 'webcodecs' ? 'WebCodecs' : meta.engine === 'prores' ? 'ProRes · WASM local' : 'FFmpeg · WASM local'} · ${meta.precision === 'exact' ? 'Marcas de tiempo exactas' : 'Compatibilidad'}` : 'Hecho para mirar más de cerca.'}</span><button onClick={() => setHelp(true)}><QuestionIcon size={14}/>Atajos y ayuda</button></footer>
    {busy && batchController.current && <div className="batch-status"><CircleNotchIcon size={17} className="spin"/><span>Extrayendo fotogramas · {Math.round(progress * 100)}%</span><button onClick={() => batchController.current?.abort()}>Cancelar</button></div>}
    {notice && <div role={notice.error ? 'alert' : 'status'} className={`toast ${notice.error ? 'error' : ''}`}>{notice.error ? <QuestionIcon size={17}/> : <CheckIcon size={17}/>}<span>{notice.text}</span><button aria-label="Cerrar notificación" onClick={() => setNotice(null)}><XIcon size={14}/></button></div>}
    {dragging && <div className="drop-overlay"><div><FolderOpenIcon size={39}/><strong>Suelta tu video aquí</strong><span>Se abrirá directamente desde tu dispositivo.</span></div></div>}
    <AnimatedDialog open={help} onClose={() => setHelp(false)} labelledBy="help-title" className="help-dialog"><div className="dialog-heading"><div><span className="eyebrow">TU MESA DE EDICIÓN, MÁS RÁPIDA</span><h2 id="help-title">Todo, al alcance de tus teclas.</h2></div><IconButton label="Cerrar ayuda" onClick={() => setHelp(false)}><XIcon size={20}/></IconButton></div><div className="modal-scroll"><div className="shortcut-list">{shortcuts.map(([key, label]) => <div key={key}><span>{label}</span><kbd>{key}</kbd></div>)}</div><div className="help-notes"><p><strong>Precisión y color.</strong> Las flechas recorren cuadros reales por sus marcas de tiempo. El timecode usa numeración sin salto (NDF); en videos de frecuencia variable es nominal. El PNG conserva los píxeles decodificados al tamaño de salida. HDR, color de 10 bits y alfa dependen de la decodificación del navegador.</p><p><strong>Layouts.</strong> Automático adapta el espacio a la orientación del video. Vertical coloca las capturas a la derecha para ganar altura; Horizontal conserva la bandeja inferior. Visor grande comienza con los paneles ocultos. Cada layout recuerda sus tamaños y visibilidad; puedes recuperar los paneles desde la barra superior.</p><p><strong>Sesión local.</strong> Las capturas son temporales. Descárgalas antes de cerrar o recargar. La bandeja y cada ZIP admiten hasta 256 MiB. Los formatos de compatibilidad pueden decodificarse más lentamente.</p><p><strong>Sin conexión.</strong> La versión de producción guarda sus recursos en este dispositivo después de la primera carga completa. No se envía el contenido de tus videos a ningún servidor.</p></div></div></AnimatedDialog>
    <AnimatedDialog open={previewOpen} onClose={() => setPreviewOpen(false)} onAfterClose={() => setPreview(null)} labelledBy="preview-title" className="preview-dialog">{preview && <><div className="dialog-heading"><div><h2 id="preview-title" className="mono">{preview.capture.timecode}</h2><span className="muted">{preview.capture.width} × {preview.capture.height} · {bytes(preview.capture.size)} · {preview.capture.format.toUpperCase()}</span></div><IconButton label="Cerrar previsualización" onClick={() => setPreviewOpen(false)}><XIcon size={20}/></IconButton></div><div className="modal-scroll preview-canvas"><img className="preview-image" src={preview.url} alt={`Captura completa ${preview.capture.timecode}`}/></div><div className="preview-footer"><span className="mono">{preview.capture.filename}</span><div className="preview-actions"><button className="button secondary" onClick={() => void compareCapture(preview.capture)}>A/B</button><button className="button primary" onClick={() => void downloadCapture(store.current, preview.capture).catch(report)}><DownloadSimpleIcon size={16}/>Descargar</button></div></div></>}</AnimatedDialog>
    <AnimatedDialog open={!!comparison} onClose={() => setComparison(null)} labelledBy="comparison-title" className="comparison-dialog">{comparison && <><div className="dialog-heading"><div><span className="eyebrow">COMPARACIÓN A/B</span><h2 id="comparison-title">Desliza para revelar el cambio</h2></div><IconButton label="Cerrar comparación" onClick={() => setComparison(null)}><XIcon size={20}/></IconButton></div><div className="comparison-stage"><img src={comparison.left.url} alt={`Referencia ${comparison.left.capture.timecode}`}/><img className="comparison-right" style={{ clipPath: `inset(0 0 0 ${comparisonSplit}%)` }} src={comparison.right.url} alt={`Comparación ${comparison.right.capture.timecode}`}/><div className="comparison-divider" style={{ left: `${comparisonSplit}%` }}/><input aria-label="Divisor de comparación" type="range" min="0" max="100" value={comparisonSplit} onChange={event => setComparisonSplit(Number(event.target.value))}/></div><div className="comparison-labels mono"><span>A · {comparison.left.capture.timecode}</span><span>B · {comparison.right.capture.timecode}</span></div></>}</AnimatedDialog>
  </div>;
}
export default App;
