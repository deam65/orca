import { useCallback, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import type { BrowserScreencastFrameMetadata } from '../screencast/browser-screencast-protocol'
import { browserPointerWheel } from './mobile-browser-command-operations'
import type { BrowserPageParams } from './use-mobile-browser-request'
import {
  browserWheelDeltaFromScreen,
  computeBrowserFrameGeometry,
  type BrowserPoint,
  type BrowserTouchLayout,
  type BrowserZoomState
} from './browser-touch-geometry'

type PendingWheelCommand = {
  base: BrowserPageParams
  point: BrowserPoint
  gestureId: number
  dx: number
  dy: number
}

type BrowserWheelQueueArgs = {
  client: RpcClient | null
  frameMetadataRef: { current: BrowserScreencastFrameMetadata | null }
  layoutRef: { current: BrowserTouchLayout | null }
  pageParams: () => BrowserPageParams | null
  setError: Dispatch<SetStateAction<string | null>>
  zoomRef: { current: BrowserZoomState }
}

const MAX_IN_FLIGHT_WHEEL_COMMANDS = 2

export function useMobileBrowserWheelQueue(args: BrowserWheelQueueArgs) {
  const { client, frameMetadataRef, layoutRef, pageParams, setError, zoomRef } = args
  const pendingWheelCommandRef = useRef<PendingWheelCommand | null>(null)
  const inFlightCountRef = useRef(0)
  const commandGenerationRef = useRef(0)
  const commandsMountedRef = useRef(false)

  useLayoutEffect(() => {
    commandsMountedRef.current = true
    return () => {
      commandsMountedRef.current = false
      commandGenerationRef.current += 1
      pendingWheelCommandRef.current = null
      inFlightCountRef.current = 0
    }
  }, [client, pageParams])

  const flushPendingWheelCommand = useCallback(() => {
    if (!commandsMountedRef.current || inFlightCountRef.current >= MAX_IN_FLIGHT_WHEEL_COMMANDS) {
      return
    }
    const pending = pendingWheelCommandRef.current
    if (!pending || !client) {
      return
    }
    pendingWheelCommandRef.current = null
    inFlightCountRef.current += 1
    const generation = commandGenerationRef.current
    void (async () => {
      try {
        if (generation !== commandGenerationRef.current) {
          return
        }
        const wheelReply = await browserPointerWheel.request(client, {
          ...pending.base,
          dx: pending.dx,
          dy: pending.dy,
          x: pending.point.x,
          y: pending.point.y
        })
        browserPointerWheel.interpret(wheelReply)
        if (generation === commandGenerationRef.current) {
          setError(null)
        }
      } catch {
        // Scroll bursts race navigation; ignore.
      } finally {
        if (generation === commandGenerationRef.current) {
          inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1)
          flushPendingWheelCommand()
        }
      }
    })()
  }, [client])

  const sendWheel = useCallback(
    (point: BrowserPoint, screenDx: number, screenDy: number, gestureId: number) => {
      const base = pageParams()
      if (!commandsMountedRef.current || !client || !base) {
        return
      }
      const geometry = computeBrowserFrameGeometry(layoutRef.current, frameMetadataRef.current)
      const delta = browserWheelDeltaFromScreen(screenDx, screenDy, geometry, zoomRef.current.scale)
      if (Math.abs(delta.dx) < 1 && Math.abs(delta.dy) < 1) {
        return
      }
      const pending = pendingWheelCommandRef.current
      pendingWheelCommandRef.current =
        pending && pending.base.page === base.page && pending.gestureId === gestureId
          ? {
              base,
              point,
              gestureId,
              dx: pending.dx + delta.dx,
              dy: pending.dy + delta.dy
            }
          : { base, point, gestureId, ...delta }
      flushPendingWheelCommand()
    },
    [client, flushPendingWheelCommand, pageParams]
  )

  return { commandGenerationRef, commandsMountedRef, sendWheel }
}
