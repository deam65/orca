import { Buffer } from 'node:buffer'
import type { Debugger, WebContents } from 'electron'
import { readBrowserScreencastImageSize } from './browser-screencast-image-size'
import { runDebuggerCommandWithTimeout } from './browser-screencast-debugger-command'
import { holdPaintUntilCdpCaptureSettles } from '../debugger/guest-paint-hold'
import { captureCroppedViewportImage } from './browser-screencast-cropped-live-capture'
import type {
  BrowserScreencastOptions,
  PendingScreencastFrame
} from './browser-screencast-stream-types'
import { positiveInteger } from './browser-screencast-viewport-fit'

const STILL_FRAME_MIN_QUALITY = 92

type BrowserScreencastSnapshotCaptureDeps = {
  webContents: WebContents
  dbg: Debugger
  options: BrowserScreencastOptions
  isClosed: () => boolean
  isStopping: () => boolean
  // Stop must not wait out a capturePage a non-drawing guest leaves pending; its result is stale anyway.
  stopSignal: AbortSignal
  getSeq: () => number
  queueFrame: (frame: PendingScreencastFrame) => void
  applyDeviceMetricsOverride: () => Promise<void>
  /** One capture at a time per page: clipped CDP captures swap the page's emulation while they run. */
  runExclusive: (capture: () => Promise<void>) => Promise<void>
}

export type BrowserScreencastSnapshotCapture = {
  emitSnapshotFrame: (
    initialOnly: boolean,
    generation?: number,
    qualityOverride?: number,
    skipDeviceMetricsOverride?: boolean
  ) => Promise<void>
  /** A capture that a newer live frame makes stale, so it never replaces one. */
  emitStillFrame: () => Promise<void>
  scheduleNavigationFrameCapture: (reason?: 'navigation' | 'viewport-recovery') => void
  clearNavigationCaptureTimer: () => void
  hasPendingNavigationCapture: () => boolean
  bumpGeneration: () => void
}

export function createBrowserScreencastSnapshotCapture(
  deps: BrowserScreencastSnapshotCaptureDeps
): BrowserScreencastSnapshotCapture {
  const { webContents, dbg, options, isClosed, isStopping, stopSignal, getSeq, queueFrame } = deps
  const { applyDeviceMetricsOverride } = deps
  const { holdPaint } = options

  let snapshotGeneration = 0
  let navigationCaptureTimer: ReturnType<typeof setTimeout> | null = null
  let navigationCaptureGeneration: number | null = null

  const clearNavigationCaptureTimer = (): void => {
    if (navigationCaptureTimer) {
      clearTimeout(navigationCaptureTimer)
      navigationCaptureTimer = null
      navigationCaptureGeneration = null
    }
  }

  const scheduleNavigationFrameCapture = (
    reason: 'navigation' | 'viewport-recovery' = 'navigation'
  ): void => {
    if (isClosed() || isStopping()) {
      return
    }
    if (reason === 'viewport-recovery' && navigationCaptureGeneration === snapshotGeneration) {
      return
    }
    clearNavigationCaptureTimer()
    const generation = ++snapshotGeneration
    navigationCaptureGeneration = generation
    // Static pages may finish navigation without emitting a live frame.
    navigationCaptureTimer = setTimeout(() => {
      navigationCaptureTimer = null
      void emitSnapshotFrame(false, generation).finally(() => {
        if (navigationCaptureGeneration === generation) {
          navigationCaptureGeneration = null
        }
      })
    }, 100)
  }

  const isSnapshotStale = (initialOnly: boolean, generation?: number): boolean =>
    isClosed() ||
    isStopping() ||
    (initialOnly && getSeq() > 0) ||
    (generation !== undefined && generation !== snapshotGeneration)

  const emitSnapshotFrame = (
    initialOnly: boolean,
    generation?: number,
    qualityOverride?: number,
    skipDeviceMetricsOverride = false
  ): Promise<void> =>
    deps.runExclusive(() =>
      captureSnapshotFrame(initialOnly, generation, qualityOverride, skipDeviceMetricsOverride)
    )

  const captureSnapshotFrame = async (
    initialOnly: boolean,
    generation?: number,
    qualityOverride?: number,
    skipDeviceMetricsOverride = false
  ): Promise<void> => {
    if (isSnapshotStale(initialOnly, generation)) {
      return
    }
    try {
      const viewportWidth = positiveInteger(options.viewportWidth)
      const viewportHeight = positiveInteger(options.viewportHeight)
      const quality = qualityOverride ?? options.quality
      let image: Uint8Array | null = null
      if (!skipDeviceMetricsOverride) {
        await applyDeviceMetricsOverride()
      }
      if (isSnapshotStale(initialOnly, generation)) {
        return
      }
      if (viewportWidth && viewportHeight && typeof webContents.capturePage === 'function') {
        try {
          image = await captureCroppedViewportImage({
            webContents,
            options,
            stopSignal,
            viewportWidth,
            viewportHeight,
            quality
          })
          if (isSnapshotStale(initialOnly, generation)) {
            return
          }
        } catch {
          image = null
        }
      }
      if (!image) {
        const screenshotParams = {
          format: options.format,
          ...(options.format === 'jpeg' ? { quality } : {}),
          ...(viewportWidth && viewportHeight
            ? {
                // Keep fallback frames in the live viewport's coordinate space under mobile emulation and DPR.
                clip: {
                  x: 0,
                  y: 0,
                  width: viewportWidth,
                  height: viewportHeight,
                  scale: 1
                }
              }
            : {}),
          captureBeyondViewport: false
        }
        // Not raced with stop: a clipped capture Chromium finishes late re-applies the phone metrics after the clear.
        const result = await runDebuggerCommandWithTimeout('Page.captureScreenshot', () =>
          holdPaintUntilCdpCaptureSettles(webContents, holdPaint, () =>
            dbg.sendCommand('Page.captureScreenshot', screenshotParams)
          )
        )
        if (isSnapshotStale(initialOnly, generation)) {
          return
        }
        const payload =
          result && typeof result === 'object' ? (result as Record<string, unknown>) : {}
        const data = typeof payload.data === 'string' ? payload.data : null
        if (!data) {
          return
        }
        image = new Uint8Array(Buffer.from(data, 'base64'))
      }
      if (isSnapshotStale(initialOnly, generation)) {
        return
      }
      const imageSize = readBrowserScreencastImageSize(image, options.format)
      const baseMetadata =
        viewportWidth && viewportHeight
          ? { deviceWidth: viewportWidth, deviceHeight: viewportHeight }
          : imageSize
            ? { deviceWidth: imageSize.width, deviceHeight: imageSize.height }
            : {}
      queueFrame({
        // Include dimensions so mobile clients do not stretch static-page fallback frames.
        metadata: {
          ...baseMetadata,
          ...(imageSize ? { imageWidth: imageSize.width, imageHeight: imageSize.height } : {})
        },
        image
      })
    } catch {
      // Live frames can still arrive after a fallback capture fails.
    }
  }

  return {
    emitSnapshotFrame,
    emitStillFrame: () =>
      emitSnapshotFrame(
        false,
        ++snapshotGeneration,
        Math.min(100, Math.max(options.quality, STILL_FRAME_MIN_QUALITY)),
        true
      ),
    scheduleNavigationFrameCapture,
    clearNavigationCaptureTimer,
    hasPendingNavigationCapture: () =>
      navigationCaptureTimer !== null || navigationCaptureGeneration !== null,
    bumpGeneration: () => {
      snapshotGeneration += 1
    }
  }
}
