import {
  clearScreencastFrames,
  stageScreencastFrame,
  supportsScreencastFrames,
  type OrcaMobileWebShellViewHandle
} from '../../../modules/orca-mobile-web-shell/src/index'
import type { BridgeHostOptions } from '../host-bridge/bridge-host-contract'
import type { MobileWebShellBridgeArgs } from './use-mobile-web-shell-bridge'

// Read each handler from the latest committed args; captured render closures would outlive their screen state.
export function latestBridgeCallbacks(args: { readonly current: MobileWebShellBridgeArgs }) {
  return {
    onNavigate: (href, replace) => args.current.onNavigate(href, replace),
    onNavigateBack: () => args.current.onNavigateBack(),
    onExternalLink: (url) => args.current.onExternalLink(url),
    onHaptic: (kind) => args.current.onHaptic(kind),
    serveNativeVerb: (verb, params) => args.current.serveNativeVerb(verb, params),
    readStorage: () => args.current.readStorage(),
    onStorageWrite: (key, value) => args.current.onStorageWrite(key, value),
    onPageFault: (error) => args.current.onPageFault(error),
    onRouteParamClear: (param, value) => args.current.onRouteParamClear(param, value),
    onRouteRefused: (issue) => args.current.onRouteRefused(issue),
    onBinaryFramesDropped: (total) => args.current.onBinaryFramesDropped(total),
    onPageReady: () => args.current.onPageReady(),
    onPagePainted: () => args.current.onPagePainted(),
    onPageBackClaim: (claimed) => args.current.onPageBackClaim(claimed),
    onPageLocation: (href) => args.current.onPageLocation(href),
    onPageSwapSafe: (safe, round) => args.current.onPageSwapSafe(safe, round),
    onTerminalKeyRailClaim: (claimed, inputOwner, toolbar) =>
      args.current.onTerminalKeyRailClaim(claimed, inputOwner, toolbar)
  } satisfies Partial<BridgeHostOptions>
}

export function screencastFrameCallbacks(
  sessionId: string,
  viewRef: { readonly current: { sessionId: string; handle: OrcaMobileWebShellViewHandle } | null }
): Partial<Pick<BridgeHostOptions, 'stageScreencastFrame' | 'clearScreencastFrames'>> {
  if (!supportsScreencastFrames()) {
    return {}
  }
  return {
    stageScreencastFrame: (streamId, frameSeq, mimeType, data) => {
      const mounted = viewRef.current
      if (mounted === null || mounted.sessionId !== sessionId) {
        return null
      }
      return stageScreencastFrame(sessionId, streamId, frameSeq, mimeType, data)
    },
    clearScreencastFrames: (streamId) => {
      const mounted = viewRef.current
      if (mounted !== null && mounted.sessionId === sessionId) {
        clearScreencastFrames(sessionId, streamId)
      }
    }
  }
}
