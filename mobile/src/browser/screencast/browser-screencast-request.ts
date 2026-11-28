import {
  assembleMobileBrowserScreencastRequest,
  MOBILE_HIGH_DENSITY_DEVICE_SCALE_FACTOR,
  MOBILE_VIEW_DEVICE_SCALE_FACTOR,
  type BrowserStreamLayout,
  type MobileBrowserScreencastRequest,
  type MobileBrowserViewMode
} from './browser-screencast-request-parameters'

// Native socket frames have no bridge per-message cap; request desired density. Web sibling budgets area to fit its cap.
export function buildMobileBrowserScreencastRequest(
  layout: BrowserStreamLayout | null,
  pixelRatio: number,
  viewMode: MobileBrowserViewMode = 'web',
  _frameUrlGranted = false
): MobileBrowserScreencastRequest | null {
  const deviceScaleFactor = Math.max(
    1,
    Math.min(
      MOBILE_HIGH_DENSITY_DEVICE_SCALE_FACTOR,
      Number.isFinite(pixelRatio) ? pixelRatio : MOBILE_VIEW_DEVICE_SCALE_FACTOR
    )
  )
  return assembleMobileBrowserScreencastRequest(
    layout,
    pixelRatio,
    viewMode,
    deviceScaleFactor,
    true
  )
}
