import type { MobileBrowserViewMode } from '../screencast/browser-screencast-request-parameters'

const BROWSER_VIEW_MODE_STATE_LIMIT = 40
const browserViewModeByPageKey = new Map<string, MobileBrowserViewMode>()
const listenersByPageKey = new Map<string, Set<(mode: MobileBrowserViewMode) => void>>()

export function subscribeMobileBrowserViewMode(
  worktreeId: string,
  browserPageId: string | null,
  listener: (mode: MobileBrowserViewMode) => void
): () => void {
  const pageKey = makeBrowserViewModePageKey(worktreeId, browserPageId)
  if (!pageKey) {
    return () => {}
  }
  let listeners = listenersByPageKey.get(pageKey)
  if (!listeners) {
    listeners = new Set()
    listenersByPageKey.set(pageKey, listeners)
  }
  listeners.add(listener)
  return () => {
    const set = listenersByPageKey.get(pageKey)
    if (set) {
      set.delete(listener)
      if (set.size === 0) {
        listenersByPageKey.delete(pageKey)
      }
    }
  }
}

export function getInitialMobileBrowserViewMode(
  worktreeId: string,
  browserPageId: string | null,
  url = 'about:blank'
): MobileBrowserViewMode {
  const pageKey = makeBrowserViewModePageKey(worktreeId, browserPageId)
  if (!pageKey) {
    return defaultMobileBrowserViewMode(url)
  }
  return browserViewModeByPageKey.get(pageKey) ?? defaultMobileBrowserViewMode(url)
}

function defaultMobileBrowserViewMode(url: string): MobileBrowserViewMode {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'file:' && /\.html?$/i.test(parsed.pathname) ? 'mobile' : 'web'
  } catch {
    return 'web'
  }
}

export function saveMobileBrowserViewMode(
  worktreeId: string,
  browserPageId: string | null,
  viewMode: MobileBrowserViewMode
): void {
  const pageKey = makeBrowserViewModePageKey(worktreeId, browserPageId)
  if (!pageKey) {
    return
  }
  browserViewModeByPageKey.delete(pageKey)
  browserViewModeByPageKey.set(pageKey, viewMode)
  while (browserViewModeByPageKey.size > BROWSER_VIEW_MODE_STATE_LIMIT) {
    const oldestKey = browserViewModeByPageKey.keys().next().value
    if (typeof oldestKey !== 'string') {
      break
    }
    browserViewModeByPageKey.delete(oldestKey)
  }
  const listeners = listenersByPageKey.get(pageKey)
  if (listeners) {
    for (const listener of listeners) {
      listener(viewMode)
    }
  }
}

export function clearMobileBrowserViewModeState(): void {
  browserViewModeByPageKey.clear()
}

function makeBrowserViewModePageKey(
  worktreeId: string,
  browserPageId: string | null
): string | null {
  return browserPageId ? `${worktreeId}:${browserPageId}` : null
}
