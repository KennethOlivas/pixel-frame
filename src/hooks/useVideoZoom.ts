import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';

export const VIDEO_ZOOM_LEVELS = [10, 25, 50, 75, 100, 150, 200, 300, 400];
const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
type Point = { x: number; y: number };
type Size = { width: number; height: number };
type View = { zoom: 'fit' | number; pan: Point };
const origin: Point = { x: 0, y: 0 };

function fitScale(source: Size, viewport: Size): number {
  if (!source.width || !source.height || !viewport.width || !viewport.height) return 1;
  return Math.min(1, viewport.width / source.width, viewport.height / source.height);
}
function constrain(pan: Point, scale: number, source: Size, viewport: Size): Point {
  const x = Math.max(0, (source.width * scale - viewport.width) / 2);
  const y = Math.max(0, (source.height * scale - viewport.height) / 2);
  return { x: Math.max(-x, Math.min(x, pan.x)), y: Math.max(-y, Math.min(y, pan.y)) };
}

/** Changes presentation only: the canvas pixel buffer is never resized by zoom. */
export function useVideoZoom(width: number, height: number, enabled: boolean) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ zoom: 'fit', pan: origin });
  const [dragging, setDragging] = useState(false);
  const [wheeling, setWheeling] = useState(false);
  const drag = useRef<{ id: number; start: Point; pan: Point } | null>(null);
  const wheelTimer = useRef<number | undefined>(undefined);
  const source = { width, height };
  const scale = view.zoom === 'fit' ? fitScale(source, viewport) : view.zoom;
  const pan = constrain(view.pan, scale, source, viewport);
  const canPan = enabled && (width * scale > viewport.width + 1 || height * scale > viewport.height + 1);
  const latest = useRef({ source, viewport, scale, pan, enabled, canPan });
  latest.current = { source, viewport, scale, pan, enabled, canPan };

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setViewport(next);
      setView(current => ({ ...current, pan: current.zoom === 'fit' ? origin : constrain(current.pan, current.zoom, latest.current.source, next) }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function changeZoom(zoom: 'fit' | number, anchor: Point = origin) {
    const previous = latest.current;
    if (!previous.enabled) return;
    const nextZoom = zoom === 'fit' ? 'fit' : Math.max(MIN_SCALE, Math.min(MAX_SCALE, zoom));
    const nextScale = nextZoom === 'fit' ? fitScale(previous.source, previous.viewport) : nextZoom;
    const ratio = nextScale / previous.scale;
    // Keep the image point under the cursor (or viewport center) stationary.
    const nextPan = nextZoom === 'fit' ? origin : constrain({
      x: anchor.x - (anchor.x - previous.pan.x) * ratio,
      y: anchor.y - (anchor.y - previous.pan.y) * ratio,
    }, nextScale, previous.source, previous.viewport);
    latest.current = { ...previous, scale: nextScale, pan: nextPan };
    setView({ zoom: nextZoom, pan: nextPan });
  }
  function step(direction: -1 | 1) {
    const current = latest.current.scale * 100;
    const next = direction === 1
      ? VIDEO_ZOOM_LEVELS.find(value => value > current + 0.01) ?? 400
      : [...VIDEO_ZOOM_LEVELS].reverse().find(value => value < current - 0.01) ?? 10;
    changeZoom(next / 100);
  }
  function reset() {
    drag.current = null;
    setDragging(false);
    setView({ zoom: 'fit', pan: origin });
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!latest.current.canPan || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, pan: latest.current.pan };
    setDragging(true);
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const initial = drag.current;
    if (!initial || initial.id !== event.pointerId) return;
    const current = latest.current;
    const nextPan = constrain({ x: initial.pan.x + event.clientX - initial.start.x, y: initial.pan.y + event.clientY - initial.start.y }, current.scale, current.source, current.viewport);
    latest.current = { ...current, pan: nextPan };
    setView(value => ({ ...value, pan: nextPan }));
  }
  function pointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  }
  // Non-passive listener is necessary to intercept a trackpad pinch / Ctrl+wheel
  // without zooming the entire app. Ordinary wheel motion pans enlarged footage.
  const wheelAction = useRef<(event: WheelEvent) => void>(() => {});
  wheelAction.current = event => {
    const current = latest.current;
    if (!current.enabled || !viewportRef.current) return;
    if (!(event.ctrlKey || event.metaKey) && !current.canPan) return;
    event.preventDefault();
    setWheeling(true);
    window.clearTimeout(wheelTimer.current);
    wheelTimer.current = window.setTimeout(() => setWheeling(false), 120);
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? current.viewport.height : 1;
    if (event.ctrlKey || event.metaKey) {
      const bounds = viewportRef.current.getBoundingClientRect();
      changeZoom(current.scale * Math.exp(-Math.max(-100, Math.min(100, event.deltaY * unit)) * 0.005), {
        x: event.clientX - bounds.left - bounds.width / 2,
        y: event.clientY - bounds.top - bounds.height / 2,
      });
    } else {
      const nextPan = constrain({ x: current.pan.x - event.deltaX * unit, y: current.pan.y - event.deltaY * unit }, current.scale, current.source, current.viewport);
      latest.current = { ...current, pan: nextPan };
      setView(value => ({ ...value, pan: nextPan }));
    }
  };
  useEffect(() => {
    const viewport = viewportRef.current;
    const listener = (event: WheelEvent) => wheelAction.current(event);
    viewport?.addEventListener('wheel', listener, { passive: false });
    return () => { viewport?.removeEventListener('wheel', listener); window.clearTimeout(wheelTimer.current); };
  }, []);

  return {
    viewportRef, scale, pan, canPan, dragging, interacting: dragging || wheeling,
    value: view.zoom === 'fit' ? 'fit' : String(Math.round(view.zoom * 100)),
    percent: Math.round(scale * 100),
    canZoomIn: enabled && scale < MAX_SCALE,
    canZoomOut: enabled && scale > MIN_SCALE,
    select: (value: string) => changeZoom(value === 'fit' ? 'fit' : Number(value) / 100),
    zoomIn: () => step(1), zoomOut: () => step(-1), reset,
    pointerHandlers: { onPointerDown: pointerDown, onPointerMove: pointerMove, onPointerUp: pointerEnd, onPointerCancel: pointerEnd, onLostPointerCapture: pointerEnd, onDoubleClick: reset },
  };
}
