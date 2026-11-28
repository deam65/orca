import type { BrowserScreencastFormat } from './browser-screencast-protocol'

// Common request assembly lives outside platform siblings so .web cannot self-resolve its native import; only mobile density is passed per platform.

export type BrowserStreamLayout = {
  width: number
  height: number
}

export type MobileBrowserScreencastRequest = {
  format: BrowserScreencastFormat
  quality: number
  maxWidth: number
  maxHeight: number
  viewportWidth?: number
  viewportHeight?: number
  deviceScaleFactor?: number
  mobile?: boolean
  everyNthFrame: number
  minFrameIntervalMs: number
}

export type MobileBrowserViewMode = 'web' | 'mobile'

export const BROWSER_FRAME_FORMAT: BrowserScreencastFormat = 'jpeg'
export const BROWSER_FRAME_QUALITY = 65
export const BROWSER_HIGH_DENSITY_FRAME_QUALITY = 85
export const MOBILE_HIGH_DENSITY_DEVICE_SCALE_FACTOR = 3
const BROWSER_HIGH_DENSITY_MAX_FRAME_DIMENSION = 2880
const BROWSER_HIGH_DENSITY_WEB_MIN_DIMENSION = 1920
// Do not skip compositor frames: menus can be final static update; time throttling still bounds throughput.
const BROWSER_FRAME_EVERY_NTH_FRAME = 1
export const MOBILE_BROWSER_FRAME_MIN_INTERVAL_MS = 16
const BROWSER_MIN_FRAME_WIDTH = 320
const BROWSER_MIN_FRAME_HEIGHT = 240
const BROWSER_MAX_FRAME_WIDTH = 1600
const BROWSER_MAX_STREAM_SCALE = 2

/** What a phone's mobile view asks for when nothing is bounding the frame it gets back. */
export const MOBILE_VIEW_DEVICE_SCALE_FACTOR = 2

export function assembleMobileBrowserScreencastRequest(
  layout: BrowserStreamLayout | null,
  pixelRatio: number,
  viewMode: MobileBrowserViewMode,
  mobileViewDeviceScaleFactor: number,
  highDensity = false
): MobileBrowserScreencastRequest | null {
  if (!layout || layout.width <= 0 || layout.height <= 0) {
    return null
  }
  const maxScale = highDensity ? MOBILE_HIGH_DENSITY_DEVICE_SCALE_FACTOR : BROWSER_MAX_STREAM_SCALE
  const maxDim = highDensity ? BROWSER_HIGH_DENSITY_MAX_FRAME_DIMENSION : BROWSER_MAX_FRAME_WIDTH
  const quality = highDensity ? BROWSER_HIGH_DENSITY_FRAME_QUALITY : BROWSER_FRAME_QUALITY

  const streamScale = clamp(Number.isFinite(pixelRatio) ? pixelRatio : 1, 1, maxScale)

  let maxWidth: number
  let maxHeight: number
  if (highDensity && viewMode === 'web') {
    maxWidth = clamp(
      Math.max(Math.round(layout.width * streamScale), BROWSER_HIGH_DENSITY_WEB_MIN_DIMENSION),
      BROWSER_MIN_FRAME_WIDTH,
      maxDim
    )
    maxHeight = clamp(
      Math.max(Math.round(layout.height * streamScale), BROWSER_HIGH_DENSITY_WEB_MIN_DIMENSION),
      BROWSER_MIN_FRAME_HEIGHT,
      maxDim
    )
  } else {
    maxWidth = clamp(Math.round(layout.width * streamScale), BROWSER_MIN_FRAME_WIDTH, maxDim)
    maxHeight = clamp(Math.round(layout.height * streamScale), BROWSER_MIN_FRAME_HEIGHT, maxDim)
  }

  return {
    format: BROWSER_FRAME_FORMAT,
    quality,
    maxWidth,
    maxHeight,
    everyNthFrame: BROWSER_FRAME_EVERY_NTH_FRAME,
    minFrameIntervalMs: MOBILE_BROWSER_FRAME_MIN_INTERVAL_MS,
    ...(viewMode === 'mobile'
      ? {
          // Mobile view uses responsive CSS at measured pane size, not fixed device preset.
          viewportWidth: Math.round(layout.width),
          viewportHeight: Math.round(layout.height),
          deviceScaleFactor: mobileViewDeviceScaleFactor,
          mobile: true
        }
      : {})
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
