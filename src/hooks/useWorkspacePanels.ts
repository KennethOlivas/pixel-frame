import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { WorkspacePresentation } from './useWorkspaceLayout';

type Panel = 'inspector' | 'tray';
interface Layout {
  inspectorWidth: number;
  trayHeight: number;
  inspectorVisible: boolean;
  trayVisible: boolean;
  trayOpen: boolean;
}
const KEY = 'pixelframe-workspace-v1';
const LAYOUTS_KEY = 'pixelframe-workspaces-v2';
// Match the compact CSS layout so rotating a phone does not shrink saved desktop docks.
const isCompactWorkspace = () => window.innerWidth <= 700 || (window.innerWidth <= 1000 && window.innerHeight <= 600);
function readLayout(): Layout {
  const defaults: Layout = { inspectorWidth: window.innerWidth < 1100 ? 260 : 294, trayHeight: 167, inspectorVisible: true, trayVisible: true, trayOpen: true };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!saved || typeof saved !== 'object') return defaults;
    return {
      inspectorWidth: Number.isFinite(saved.inspectorWidth) ? Math.max(240, Math.min(520, saved.inspectorWidth)) : defaults.inspectorWidth,
      trayHeight: Number.isFinite(saved.trayHeight) ? Math.max(110, Math.min(400, saved.trayHeight)) : defaults.trayHeight,
      inspectorVisible: typeof saved.inspectorVisible === 'boolean' ? saved.inspectorVisible : true,
      trayVisible: typeof saved.trayVisible === 'boolean' ? saved.trayVisible : true,
      trayOpen: typeof saved.trayOpen === 'boolean' ? saved.trayOpen : true,
    };
  } catch { return defaults; }
}
function readLayouts(): Record<WorkspacePresentation, Layout> {
  const landscape = readLayout();
  const defaults: Record<WorkspacePresentation, Layout> = {
    landscape,
    portrait: { inspectorWidth: 330, trayHeight: 235, inspectorVisible: true, trayVisible: true, trayOpen: true },
    focus: { ...landscape, inspectorVisible: false, trayVisible: false },
  };
  try {
    const stored = JSON.parse(localStorage.getItem(LAYOUTS_KEY) || 'null');
    for (const key of ['landscape', 'portrait', 'focus'] as const) {
      const saved = stored?.[key];
      if (!saved || typeof saved !== 'object') continue;
      for (const field of ['inspectorVisible', 'trayVisible', 'trayOpen'] as const) {
        if (typeof saved[field] === 'boolean') defaults[key][field] = saved[field];
      }
      if (Number.isFinite(saved.inspectorWidth)) defaults[key].inspectorWidth = Math.max(240, Math.min(520, saved.inspectorWidth));
      if (Number.isFinite(saved.trayHeight)) defaults[key].trayHeight = Math.max(110, Math.min(400, saved.trayHeight));
    }
  } catch { /* Retain the existing workspace if preferences cannot be read. */ }
  return defaults;
}
export function useWorkspacePanels(presentation: WorkspacePresentation = 'landscape') {
  const [layouts, setLayouts] = useState(readLayouts);
  const layout = layouts[presentation];
  function setLayout(update: (current: Layout) => Layout) {
    setLayouts(current => ({ ...current, [presentation]: update(current[presentation]) }));
  }
  const [resizing, setResizing] = useState<Panel | null>(null);
  const drag = useRef<{ panel: Panel; x: number; y: number; initial: number } | null>(null);
  function limit(panel: Panel, value: number) {
    return panel === 'inspector'
      ? Math.max(240, Math.min(Math.min(520, window.innerWidth - 430), value))
      : Math.max(110, Math.min(Math.max(110, Math.min(400, window.innerHeight - (presentation === 'portrait' ? 390 : 580))), value));
  }
  function size(panel: Panel, value: number) {
    setLayout(current => ({ ...current, [panel === 'inspector' ? 'inspectorWidth' : 'trayHeight']: limit(panel, value) }));
  }
  function begin(event: PointerEvent<HTMLElement>, panel: Panel) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { panel, x: event.clientX, y: event.clientY, initial: panel === 'inspector' ? layout.inspectorWidth : layout.trayHeight };
    setResizing(panel);
  }
  function move(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current) return;
    const delta = current.panel === 'inspector' ? current.x - event.clientX : current.y - event.clientY;
    size(current.panel, current.initial + delta);
  }
  function end() { drag.current = null; setResizing(null); }
  function keyboard(event: KeyboardEvent<HTMLElement>, panel: Panel) {
    const relevant = panel === 'inspector' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (!relevant.includes(event.key) && !['Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const initial = panel === 'inspector' ? layout.inspectorWidth : layout.trayHeight;
    size(panel, event.key === 'Home' ? 0 : event.key === 'End' ? 10000 : initial + (event.key === relevant[0] ? 1 : -1) * (event.shiftKey ? 40 : 10));
  }
  function toggle(panel: Panel) {
    setLayout(current => ({ ...current, [panel === 'inspector' ? 'inspectorVisible' : 'trayVisible']: panel === 'inspector' ? !current.inspectorVisible : !current.trayVisible }));
  }
  function setTrayOpen(value: boolean | ((previous: boolean) => boolean)) {
    setLayout(current => ({ ...current, trayOpen: typeof value === 'function' ? value(current.trayOpen) : value, trayVisible: presentation === 'focus' ? current.trayVisible : true }));
  }
  useEffect(() => {
    if (resizing) return;
    try { localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts)); } catch { /* Local preferences are optional. */ }
  }, [layouts, resizing]);
  useEffect(() => {
    const resize = () => {
      if (isCompactWorkspace()) return;
      setLayout(current => ({ ...current, inspectorWidth: limit('inspector', current.inspectorWidth), trayHeight: limit('tray', current.trayHeight) }));
    };
    window.addEventListener('resize', resize);
    resize();
    return () => window.removeEventListener('resize', resize);
  }, [presentation]);
  return { ...layout, resizing, toggle, setTrayOpen,
    separatorProps: (panel: Panel) => ({
      role: 'separator' as const,
      tabIndex: 0,
      'aria-label': panel === 'inspector' ? 'Redimensionar panel de extracción' : 'Redimensionar bandeja de capturas',
      'aria-orientation': panel === 'inspector' ? 'vertical' as const : 'horizontal' as const,
      'aria-valuemin': panel === 'inspector' ? 240 : 110,
      'aria-valuemax': panel === 'inspector' ? Math.max(240, Math.min(520, window.innerWidth - 430)) : Math.max(110, Math.min(400, window.innerHeight - (presentation === 'portrait' ? 390 : 580))),
      'aria-valuenow': panel === 'inspector' ? layout.inspectorWidth : layout.trayHeight,
      'aria-controls': panel === 'inspector' && presentation === 'portrait' ? 'extraction-panel capture-tray' : panel === 'inspector' ? 'extraction-panel' : 'capture-tray',
      title: 'Arrastra para ajustar · doble clic para restablecer · flechas para ajuste fino',
      onPointerDown: (event: PointerEvent<HTMLElement>) => begin(event, panel),
      onPointerMove: move, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => keyboard(event, panel),
      onDoubleClick: () => size(panel, panel === 'inspector' ? (presentation === 'portrait' ? 330 : 294) : (presentation === 'portrait' ? 235 : 167)),
    }),
  };
}
