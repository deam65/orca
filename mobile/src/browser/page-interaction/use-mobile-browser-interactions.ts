import { useLayoutEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import {
  PanResponder,
  type GestureResponderEvent,
  type PanResponderGestureState
} from 'react-native'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import {
  createPinchGesture,
  MAX_ZOOM,
  MIN_ZOOM,
  updatePinchZoom,
  type PinchGesture
} from '../screencast/mobile-browser-frame-state'
import {
  clampBrowserZoomState,
  readLocalTouchPoint,
  type BrowserFrameGeometry,
  type BrowserTouchLayout,
  type BrowserZoomState,
  type BrowserPoint
} from './browser-touch-geometry'
import type { BrowserDialogState } from '../screencast/mobile-browser-stream-events'
import type { BrowserPageCommandSend, BrowserPageParams } from './use-mobile-browser-request'
import type { BrowserScreencastFrameMetadata } from '../screencast/browser-screencast-protocol'
import { createTouchScrollVelocity, useBrowserScrollMomentum } from './browser-scroll-momentum'
import { useMobileBrowserCommands } from './use-mobile-browser-commands'

const TAP_SLOP = 12
const SCROLL_START_SLOP = 10
const LONG_PRESS_MS = 550
const WHEEL_INTERVAL_MS = 16

type PanGesture = { x: number; y: number; offsetX: number; offsetY: number }
type SendBrowserRequest = (
  send: BrowserPageCommandSend,
  options?: { showBusy?: boolean; suppressError?: boolean; timeoutMs?: number }
) => Promise<unknown | null>

type MobileBrowserInteractionArgs = {
  clearLongPressTimer: () => void
  client: RpcClient | null
  pageCoveredRef: { current: boolean }
  gestureCancelledRef: { current: boolean }
  frameGeometry: BrowserFrameGeometry | null
  frameMetadataRef: { current: BrowserScreencastFrameMetadata | null }
  layoutRef: { current: BrowserTouchLayout | null }
  longPressTimerRef: { current: ReturnType<typeof setTimeout> | null }
  onToast: (message: string, durationMs?: number) => void
  pageParams: () => BrowserPageParams | null
  panRef: { current: PanGesture | null }
  pinchRef: { current: PinchGesture | null }
  sendBrowserRequest: SendBrowserRequest
  setDialog: Dispatch<SetStateAction<BrowserDialogState | null>>
  setError: Dispatch<SetStateAction<string | null>>
  scrollingRef: { current: boolean }
  startPointRef: { current: { x: number; y: number; t: number } | null }
  setZoom: Dispatch<SetStateAction<BrowserZoomState>>
  zoomRef: { current: BrowserZoomState }
}

export function useMobileBrowserInteractions(args: MobileBrowserInteractionArgs) {
  const {
    clearLongPressTimer,
    client,
    pageCoveredRef,
    gestureCancelledRef,
    frameGeometry,
    frameMetadataRef,
    layoutRef,
    longPressTimerRef,
    onToast,
    pageParams,
    panRef,
    pinchRef,
    scrollingRef,
    sendBrowserRequest,
    setDialog,
    setError,
    setZoom,
    startPointRef,
    zoomRef
  } = args

  const rightClickSentRef = useRef(false)
  const lastWheelRef = useRef({ dx: 0, dy: 0, at: 0 })
  const wheelGestureIdRef = useRef(0)
  const lastScrollPointRef = useRef<BrowserPoint | null>(null)
  const velocityRef = useRef(createTouchScrollVelocity())

  const { mapTouchPoint, pageInput, sendDialogCommand, sendPointerClick, sendWheel } =
    useMobileBrowserCommands({
      client,
      frameMetadataRef,
      layoutRef,
      onToast,
      pageParams,
      sendBrowserRequest,
      setDialog,
      setError,
      zoomRef
    })

  const { cancelMomentum, startMomentum } = useBrowserScrollMomentum({
    pageCoveredRef,
    sendWheel
  })

  const clearActiveGesture = () => {
    clearLongPressTimer()
    pinchRef.current = null
    panRef.current = null
    scrollingRef.current = false
    startPointRef.current = null
  }

  const latestHandlers = {
    onGrant: (event: GestureResponderEvent) => {
      cancelMomentum()
      gestureCancelledRef.current = false
      const pinch = createPinchGesture(event, frameGeometry, zoomRef.current)
      if (pinch) {
        clearActiveGesture()
        pinchRef.current = pinch
        return
      }
      const startPoint = readLocalTouchPoint(event.nativeEvent)
      if (!startPoint) {
        return
      }
      startPointRef.current = { x: startPoint.x, y: startPoint.y, t: Date.now() }
      rightClickSentRef.current = false
      scrollingRef.current = false
      wheelGestureIdRef.current += 1
      lastWheelRef.current = { dx: 0, dy: 0, at: 0 }
      lastScrollPointRef.current = mapTouchPoint(startPoint.x, startPoint.y)
      velocityRef.current.reset(startPoint.x, startPoint.y, Date.now())
      panRef.current =
        zoomRef.current.scale > MIN_ZOOM
          ? {
              x: startPoint.x,
              y: startPoint.y,
              offsetX: zoomRef.current.offsetX,
              offsetY: zoomRef.current.offsetY
            }
          : null
      clearLongPressTimer()
      longPressTimerRef.current = setTimeout(() => {
        const start = startPointRef.current
        if (!start) {
          return
        }
        const point = mapTouchPoint(start.x, start.y)
        if (!point) {
          return
        }
        rightClickSentRef.current = true
        void sendPointerClick(point, 'right')
        onToast('Right click')
      }, LONG_PRESS_MS)
    },
    onMove: (event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      if (gestureCancelledRef.current) {
        return
      }
      const startedPinch = pinchRef.current
        ? null
        : createPinchGesture(event, frameGeometry, zoomRef.current)
      if (startedPinch) {
        clearActiveGesture()
        pinchRef.current = startedPinch
      }
      const activePinch = pinchRef.current
      const nextPinch = activePinch ? updatePinchZoom(event, frameGeometry, activePinch) : null
      if (nextPinch) {
        clearLongPressTimer()
        zoomRef.current = nextPinch
        setZoom(nextPinch)
        return
      }
      if (activePinch) {
        pinchRef.current = null
      }
      const moved = Math.hypot(gesture.dx, gesture.dy)
      if (moved > TAP_SLOP) {
        clearLongPressTimer()
      }
      const activePan = panRef.current
      if (activePan && frameGeometry) {
        const currentPoint = readLocalTouchPoint(event.nativeEvent)
        if (!currentPoint) {
          return
        }
        if (!scrollingRef.current && moved <= TAP_SLOP) {
          return
        }
        scrollingRef.current = true
        startPointRef.current = null
        const nextZoom = clampBrowserZoomState(
          {
            scale: zoomRef.current.scale,
            offsetX: activePan.offsetX + currentPoint.x - activePan.x,
            offsetY: activePan.offsetY + currentPoint.y - activePan.y
          },
          frameGeometry,
          MIN_ZOOM,
          MAX_ZOOM
        )
        zoomRef.current = nextZoom
        setZoom(nextZoom)
        return
      }
      if (!scrollingRef.current) {
        if (moved <= SCROLL_START_SLOP) {
          return
        }
        scrollingRef.current = true
        startPointRef.current = null
      }

      const now = Date.now()
      const touch = readLocalTouchPoint(event.nativeEvent)
      if (touch) {
        const mapped = mapTouchPoint(touch.x, touch.y)
        if (mapped) {
          lastScrollPointRef.current = mapped
        }
        velocityRef.current.sample(touch.x, touch.y, now)
      }
      if (now - lastWheelRef.current.at < WHEEL_INTERVAL_MS) {
        return
      }
      const deltaX = gesture.dx - lastWheelRef.current.dx
      const deltaY = gesture.dy - lastWheelRef.current.dy
      if (Math.abs(deltaX) + Math.abs(deltaY) < 2) {
        return
      }
      const point = lastScrollPointRef.current
      if (!point) {
        return
      }
      lastWheelRef.current = { dx: gesture.dx, dy: gesture.dy, at: now }
      sendWheel(point, deltaX, deltaY, wheelGestureIdRef.current)
    },
    onRelease: (event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      clearLongPressTimer()
      const wasPinching = pinchRef.current !== null
      const wasPanning = panRef.current !== null
      pinchRef.current = null
      panRef.current = null
      const start = startPointRef.current
      startPointRef.current = null
      const wasScrolling = scrollingRef.current
      scrollingRef.current = false
      if (wasScrolling && !wasPanning && !wasPinching) {
        const deltaX = gesture.dx - lastWheelRef.current.dx
        const deltaY = gesture.dy - lastWheelRef.current.dy
        const touchPoint = readLocalTouchPoint(event.nativeEvent)
        const point =
          lastScrollPointRef.current ??
          (touchPoint ? mapTouchPoint(touchPoint.x, touchPoint.y) : null)
        if (Math.abs(deltaX) + Math.abs(deltaY) >= 1 && point) {
          sendWheel(point, deltaX, deltaY, wheelGestureIdRef.current)
        }
        if (point) {
          const { vx, vy } = velocityRef.current.read()
          startMomentum(point, vx, vy, wheelGestureIdRef.current)
        }
        return
      }
      if (!start || rightClickSentRef.current || wasScrolling) {
        return
      }
      const moved = Math.hypot(gesture.dx, gesture.dy)
      if (moved <= TAP_SLOP && Date.now() - start.t < LONG_PRESS_MS) {
        const release = readLocalTouchPoint(event.nativeEvent) ?? start
        const point = mapTouchPoint(release.x, release.y)
        if (point) {
          void sendPointerClick(point, 'left')
        }
      }
    },
    onTerminate: () => {
      cancelMomentum()
      clearActiveGesture()
    }
  }
  const handlersRef = useRef(latestHandlers)
  useLayoutEffect(() => {
    handlersRef.current = latestHandlers
  })

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !pageCoveredRef.current,
        onMoveShouldSetPanResponder: () => !pageCoveredRef.current,
        onPanResponderGrant: (e) => handlersRef.current.onGrant(e),
        onPanResponderMove: (e, g) => handlersRef.current.onMove(e, g),
        onPanResponderRelease: (e, g) => handlersRef.current.onRelease(e, g),
        onPanResponderTerminate: () => handlersRef.current.onTerminate(),
        onPanResponderTerminationRequest: (event) =>
          !('type' in event.nativeEvent) || event.nativeEvent.type !== 'contextmenu'
      }),
    [pageCoveredRef]
  )

  return { cancelMomentum, panResponder, pageInput, sendDialogCommand }
}
