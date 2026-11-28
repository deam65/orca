import type { Debugger, WebContents } from 'electron'
import {
  detachOrcaPageSession,
  type GuestSessionCdpSender
} from '../input/guest-frame-input-sessions'
import type { BrowserScreencastFrameMetadata } from '../../../../shared/browser/screencast/browser-screencast-protocol'
import { runDebuggerCommandWithTimeout } from './browser-screencast-debugger-command'
import { createBrowserScreencastFrameHandler } from './browser-screencast-cdp-events'
import { createBrowserScreencastCroppedLiveCapture } from './browser-screencast-cropped-live-capture'
import { createBrowserScreencastFramePacer } from './browser-screencast-frame-pacer'
import { createBrowserScreencastMotionQuality } from './browser-screencast-motion-quality'
import { createBrowserScreencastSnapshotCapture } from './browser-screencast-snapshot-capture'
import { positiveInteger } from './browser-screencast-viewport-fit'
import type {
  BrowserScreencastFrameBudget,
  BrowserScreencastLane,
  BrowserScreencastOptions,
  BrowserScreencastViewport
} from './browser-screencast-stream-types'

type BrowserScreencastLaneDeps = {
  webContents: WebContents
  dbg: Debugger
  /** A CDP session of its own; undefined runs on the stream's session. */
  cdpSessionId: string | undefined
  options: BrowserScreencastOptions
  isStreamClosed: () => boolean
  isStreamStopping: () => boolean
  streamStopSignal: AbortSignal
  /** Runs after the stream's queued viewport and budget changes. */
  enqueue: (work: () => Promise<void>) => Promise<void>
  readZoomFactor: () => number
  applyDeviceMetricsOverride: () => Promise<void>
  isDeviceMetricsOverridden: () => boolean
  runExclusiveCapture: (capture: () => Promise<void>) => Promise<void>
  observeGuestViewSize: (metadata: BrowserScreencastFrameMetadata) => boolean
  sendPageCommand: GuestSessionCdpSender
  onStopped: () => void
}

export type BrowserScreencastLaneController = {
  handle: BrowserScreencastLane
  cdpSessionId: string | undefined
  start: () => Promise<void>
  handleFrame: (params: unknown) => void
  scheduleNavigationFrameCapture: () => void
  /** The viewport changed: drop frames of the old layout and send the new one. */
  reemulate: () => Promise<void>
  setViewport: (viewport: BrowserScreencastViewport) => void
  getSeq: () => number
  isStopped: () => boolean
  /** The stream closed: its CDP sessions are gone, so only local state is cleared. */
  close: () => void
}

export function createBrowserScreencastLane(
  deps: BrowserScreencastLaneDeps
): BrowserScreencastLaneController {
  const { webContents, dbg, cdpSessionId, options, enqueue } = deps
  let stopping = false
  let closed = false
  // Embedded webviews emit the full host surface under mobile emulation; shrink CDP frames to cheap damage pings.
  let damageOnlyScreencast = false
  const stopRequested = new AbortController()
  const isClosed = (): boolean => closed || deps.isStreamClosed()
  const isStopping = (): boolean => stopping || deps.isStreamStopping()
  const sendCommand = (method: string, params: Record<string, unknown> = {}): Promise<unknown> =>
    runDebuggerCommandWithTimeout(method, () =>
      cdpSessionId === undefined
        ? dbg.sendCommand(method, params)
        : dbg.sendCommand(method, params, cdpSessionId)
    )

  const startScreencast = (): Promise<unknown> =>
    sendCommand(
      'Page.startScreencast',
      damageOnlyScreencast
        ? {
            format: 'jpeg',
            quality: 10,
            maxWidth: 320,
            maxHeight: 240,
            everyNthFrame: options.everyNthFrame
          }
        : {
            format: options.format,
            quality: options.quality,
            maxWidth: options.maxWidth,
            maxHeight: options.maxHeight,
            everyNthFrame: options.everyNthFrame
          }
    )

  const framePacer = createBrowserScreencastFramePacer({
    sendCommand,
    options,
    isClosed,
    isStopping,
    readZoomFactor: deps.readZoomFactor
  })
  const restartScreencast = (): Promise<void> =>
    enqueue(async () => {
      if (!isClosed() && !isStopping()) {
        await startScreencast()
      }
    })
  const enableDamageOnlyScreencast = (): void => {
    if (damageOnlyScreencast) {
      return
    }
    damageOnlyScreencast = true
    void restartScreencast().catch(() => {})
  }
  const motionQuality = createBrowserScreencastMotionQuality({
    options,
    isBacklogged: () => options.isViewerBacklogged?.() === true,
    restartScreencast: () => {
      if (!damageOnlyScreencast) {
        void restartScreencast().catch(() => {})
      }
    },
    sendSharpFrame: () => void enqueue(() => snapshotCapture.emitStillFrame())
  })
  const queueLiveFrame = (frame: Parameters<typeof framePacer.queueFrame>[0]): void => {
    const { imageWidth, imageHeight } = frame.metadata
    motionQuality.noteLiveFrame(
      imageWidth && imageHeight ? { width: imageWidth, height: imageHeight } : null
    )
    framePacer.queueFrame(frame)
  }
  const stopSignal = AbortSignal.any([deps.streamStopSignal, stopRequested.signal])
  const snapshotCapture = createBrowserScreencastSnapshotCapture({
    webContents,
    dbg,
    options,
    isClosed,
    isStopping,
    stopSignal,
    getSeq: framePacer.getSeq,
    queueFrame: framePacer.queueFrame,
    applyDeviceMetricsOverride: deps.applyDeviceMetricsOverride,
    runExclusive: deps.runExclusiveCapture
  })
  const croppedLiveCapture = createBrowserScreencastCroppedLiveCapture({
    webContents,
    options,
    isClosed,
    isStopping,
    stopSignal,
    isDeviceMetricsOverridden: deps.isDeviceMetricsOverridden,
    hasPendingNavigationCapture: snapshotCapture.hasPendingNavigationCapture,
    bumpSnapshotGeneration: snapshotCapture.bumpGeneration,
    scheduleViewportRecovery: () =>
      snapshotCapture.scheduleNavigationFrameCapture('viewport-recovery'),
    queueLiveFrame,
    ackScreencastFrame: framePacer.ackFrame,
    runExclusive: deps.runExclusiveCapture
  })
  const handleFrame = createBrowserScreencastFrameHandler({
    options,
    isClosed,
    isStopping,
    queueFrame: queueLiveFrame,
    ackScreencastFrame: framePacer.ackFrame,
    scheduleNavigationFrameCapture: snapshotCapture.scheduleNavigationFrameCapture,
    clearNavigationCaptureTimer: snapshotCapture.clearNavigationCaptureTimer,
    bumpSnapshotGeneration: snapshotCapture.bumpGeneration,
    observeGuestViewSize: deps.observeGuestViewSize,
    isDamageOnlyScreencast: () => damageOnlyScreencast,
    captureCroppedLiveFrame: (metadata, sessionId) => {
      const handled = croppedLiveCapture.capture(metadata, sessionId)
      if (handled) {
        enableDamageOnlyScreencast()
      }
      return handled
    }
  })

  const close = (): void => {
    if (closed) {
      return
    }
    closed = true
    damageOnlyScreencast = false
    motionQuality.dispose()
    snapshotCapture.clearNavigationCaptureTimer()
    croppedLiveCapture.clearPending()
    framePacer.clearPending()
    deps.onStopped()
  }

  const handle: BrowserScreencastLane = {
    updateFrameBudget: (budget: BrowserScreencastFrameBudget) =>
      enqueue(async () => {
        if (isClosed() || isStopping()) {
          return
        }
        const prevEveryNthFrame = options.everyNthFrame
        motionQuality.setFullBudget(budget)
        if (damageOnlyScreencast && options.everyNthFrame === prevEveryNthFrame) {
          return
        }
        // Chromium needs a restart for frame caps; the pacer reads its interval live.
        await startScreencast()
      }),
    stop: () => {
      if (isClosed() || stopping) {
        return
      }
      stopping = true
      damageOnlyScreencast = false
      stopRequested.abort()
      motionQuality.dispose()
      snapshotCapture.bumpGeneration()
      snapshotCapture.clearNavigationCaptureTimer()
      croppedLiveCapture.clearPending()
      framePacer.clearPending(true)
      void enqueue(async () => {
        if (deps.isStreamClosed()) {
          return
        }
        // Detaching another session ends its screencast with it.
        await (cdpSessionId === undefined
          ? sendCommand('Page.stopScreencast').catch(() => {})
          : detachOrcaPageSession(webContents, deps.sendPageCommand, cdpSessionId))
      }).finally(close)
    }
  }

  return {
    handle,
    cdpSessionId,
    start: async () => {
      await startScreencast()
      void enqueue(() => snapshotCapture.emitSnapshotFrame(true))
    },
    handleFrame,
    scheduleNavigationFrameCapture: () => snapshotCapture.scheduleNavigationFrameCapture(),
    reemulate: async () => {
      if (isClosed() || isStopping()) {
        return
      }
      snapshotCapture.bumpGeneration()
      snapshotCapture.clearNavigationCaptureTimer()
      croppedLiveCapture.clearPending()
      framePacer.clearPending(true)
      const viewportWidth = positiveInteger(options.viewportWidth)
      const viewportHeight = positiveInteger(options.viewportHeight)
      if (damageOnlyScreencast && (!viewportWidth || !viewportHeight)) {
        damageOnlyScreencast = false
        await startScreencast()
      }
      // initialOnly would skip metrics updates once this lane has emitted a frame.
      await snapshotCapture.emitSnapshotFrame(false)
    },
    setViewport: (viewport) => {
      Object.assign(options, viewport)
      const viewportWidth = positiveInteger(options.viewportWidth)
      const viewportHeight = positiveInteger(options.viewportHeight)
      if (damageOnlyScreencast && (!viewportWidth || !viewportHeight)) {
        damageOnlyScreencast = false
      }
    },
    getSeq: framePacer.getSeq,
    isStopped: () => isClosed() || stopping,
    close
  }
}
