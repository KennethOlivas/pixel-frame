import { useEffect, useState } from 'react';

export type WorkspacePresentation = 'landscape' | 'portrait' | 'focus';
export type WorkspaceLayoutMode = 'auto' | WorkspacePresentation;
const KEY = 'pixelframe-layout-mode-v1';
const MODES: WorkspaceLayoutMode[] = ['auto', 'landscape', 'portrait', 'focus'];

export function useWorkspaceLayout(width: number, height: number) {
  const [mode, setMode] = useState<WorkspaceLayoutMode>(() => {
    try {
      const saved = localStorage.getItem(KEY) as WorkspaceLayoutMode;
      return MODES.includes(saved) ? saved : 'auto';
    } catch { return 'auto'; }
  });
  const shape = width > 0 && height > width ? 'portrait' : 'landscape';
  const resolved: WorkspacePresentation = mode === 'auto' ? shape : mode;
  useEffect(() => { try { localStorage.setItem(KEY, mode); } catch { /* Optional local preference. */ } }, [mode]);
  return { mode, setMode, resolved, shape };
}
