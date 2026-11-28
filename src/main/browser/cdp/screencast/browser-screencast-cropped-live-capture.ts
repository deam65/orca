import type { WebContents } from 'electron'
import type { BrowserScreencastFrameMetadata } from '../../../../shared/browser/screencast/browser-screencast-protocol'
import { waitForPromiseWithSignal } from '../../../../shared/concurrency/abort-signal-reason'
import { withTimeout } from '../../../../shared/concurrency/promise-timeout-fallback'
import { holdPaintUntilSettled } from '../debugger/guest-paint-hold'
import { enrichFrameMetadata } from './browser-screencast-frame-metadata'
import { isEmbedderSizedScreencastGuest } from './browser-screencast-guest-view-limit'
import { readBrowserScreencastImageSize } from './browser-screencast-image-size'
import type {
  BrowserScreencastOptions,
  PendingScreencastFrame
} from './browser-screencast-stream-types'
import { positiveInteger, scaleSnapshotToFit } from './browser-screencast-viewport-fit'

export const SNAPSHOT_CAPTURE_TIMEOUT_MS = 10_000
export const LIVE_CROP_CAPTURE_TIMEOUT_MS = 2_000

export async function captureCroppedViewportImage(deps: {
  webContents: WebContents
  options: BrowserScreencastOptions
  stopSignal: AbortSignal
  viewportWidth: number
  viewportHeight: number
  quality: number
  usePaintHold?: boolean
  timeoutMs?: number
}): Promise<Uint8Array | null> {
  const {
    webContents,
    options,
    stopSignal,
    viewportWidth,
    viewportHeight,
    quality,
    usePaintHold = true,
    timeoutMs = SNAPSHOT_CAPTURE_TIMEOUT_MS
  } = deps
  // Prefer capturePage to avoid CDP tiling; stopped compositing can leave it pending.
  const runCapture = () =>
    webContents.capturePage({ x: 0, y: 0, width: viewportWidth, height: viewportHeight })
  const captureTask = usePaintHold
    ? holdPaintUntilSettled(options.holdPaint, runCapture)
    : runCapture()
  const nativeImage = await withTimeout(
    waitForPromiseWithSignal(captureTask, stopSignal),
    timeoutMs,
    null
  )
  if (!nativeImage) {
    return null
  }
  const capture = scaleSnapshotToFit(nativeImage, options)
  const buffer = options.format === 'png' ? capture.toPNG() : capture.toJPEG(quality)
  return buffer.byteLength > 0 ? new Uint8Array(buffer) : null
}

type PendingLiveCrop = {
  metadata: BrowserScreencastFrameMetadata
  sessionId: number
}

export type BrowserScreencastCroppedLiveCapture = {
  /** Immediately captures a cropped viewport on live damage for embedded webviews; returns false if ineligible. */
  capture: (metadata: BrowserScreencastFrameMetadata, sessionId: number) => boolean
  clearPending: () => void
}

export function createBrowserScreencastCroppedLiveCapture(deps: {
  webContents: WebContents
  options: BrowserScreencastOptions
  isClosed: () => boolean
  isStopping: () => boolean
  stopSignal: AbortSignal
  isDeviceMetricsOverridden: () => boolean
  hasPendingNavigationCapture: () => boolean
  bumpSnapshotGeneration: () => void
  scheduleViewportRecovery: () => void
  queueLiveFrame: (frame: PendingScreencastFrame) => void
  ackScreencastFrame: (sessionId: number | undefined) => void
  runExclusive: (capture: () => Promise<void>) => Promise<void>
}): BrowserScreencastCroppedLiveCapture {
  const { webContents, options, isClosed, isStopping, stopSignal } = deps
  const { isDeviceMetricsOverridden, queueLiveFrame, ackScreencastFrame } = deps
  const embedderSizedGuest = isEmbedderSizedScreencastGuest(webContents)

  let inFlight = false
  let pending: PendingLiveCrop | null = null
  let captureGeneration = 0

  const dropQueuedPending = (): void => {
    const queued = pending
    pending = null
    if (queued) {
      ackScreencastFrame(queued.sessionId)
    }
  }

  const clearPending = (): void => {
    captureGeneration += 1
    dropQueuedPending()
  }

  const drain = async (initial: PendingLiveCrop): Promise<void> => {
    inFlight = true
    let current: PendingLiveCrop | null = initial
    try {
      while (current) {
        const generation = captureGeneration
        if (isClosed() || isStopping()) {
          ackScreencastFrame(current.sessionId)
          break
        }
        const viewportWidth = positiveInteger(options.viewportWidth)
        const viewportHeight = positiveInteger(options.viewportHeight)
        if (!viewportWidth || !viewportHeight || typeof webContents.capturePage !== 'function') {
          ackScreencastFrame(current.sessionId)
          break
        }
        let queued = false
        try {
          const item = current
          await deps.runExclusive(async () => {
            if (generation !== captureGeneration || isClosed() || isStopping()) {
              return
            }
            const image = await captureCroppedViewportImage({
              webContents,
              options,
              stopSignal,
              viewportWidth,
              viewportHeight,
              quality: options.quality,
              usePaintHold: false,
              timeoutMs: LIVE_CROP_CAPTURE_TIMEOUT_MS
            })
            if (generation !== captureGeneration || !image || isClosed() || isStopping()) {
              return
            }
            const imageSize = readBrowserScreencastImageSize(image, options.format)
            // Keep pending navigation snapshots alive so cross-origin navigations still re-apply emulation.
            if (!deps.hasPendingNavigationCapture()) {
              deps.bumpSnapshotGeneration()
            }
            queueLiveFrame({
              metadata: enrichFrameMetadata(item.metadata, imageSize, options),
              image,
              sessionId: item.sessionId
            })
            queued = true
          })
        } catch {
          queued = false
        }
        if (generation !== captureGeneration) {
          ackScreencastFrame(current.sessionId)
        } else if (!queued) {
          ackScreencastFrame(current.sessionId)
          if (!isClosed() && !isStopping()) {
            deps.scheduleViewportRecovery()
          }
        }
        current = pending
        pending = null
      }
    } finally {
      inFlight = false
      dropQueuedPending()
    }
  }

  return {
    capture: (metadata, sessionId) => {
      if (
        !embedderSizedGuest ||
        !isDeviceMetricsOverridden() ||
        typeof webContents.capturePage !== 'function' ||
        !positiveInteger(options.viewportWidth) ||
        !positiveInteger(options.viewportHeight)
      ) {
        return false
      }
      if (inFlight) {
        dropQueuedPending()
        pending = { metadata, sessionId }
        return true
      }
      void drain({ metadata, sessionId })
      return true
    },
    clearPending
  }
}
