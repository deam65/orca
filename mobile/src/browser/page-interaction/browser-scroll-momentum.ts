import { useCallback, useEffect, useRef } from 'react'
import type { BrowserPoint } from './browser-touch-geometry'

const MOMENTUM_MIN_START_SPEED = 0.18
const MOMENTUM_MIN_STEP_SPEED = 0.04
const MOMENTUM_STEP_MS = 16
const MOMENTUM_MAX_STEPS = 40
const MOMENTUM_DECAY = 0.92
const VELOCITY_EMA_ALPHA = 0.35

export type TouchScrollVelocity = {
  reset: (x: number, y: number, at: number) => void
  sample: (x: number, y: number, at: number) => void
  read: () => { vx: number; vy: number }
}

/** Rolling EMA velocity over raw touch deltas, avoiding RN Web PanResponder's single-sample & dt=0 bugs. */
export function createTouchScrollVelocity(): TouchScrollVelocity {
  let x = 0
  let y = 0
  let t = 0
  let vx = 0
  let vy = 0
  return {
    reset: (nextX, nextY, at) => {
      x = nextX
      y = nextY
      t = at
      vx = 0
      vy = 0
    },
    sample: (nextX, nextY, at) => {
      const dt = at - t
      if (dt >= 2 && dt <= 100) {
        vx = vx * (1 - VELOCITY_EMA_ALPHA) + ((nextX - x) / dt) * VELOCITY_EMA_ALPHA
        vy = vy * (1 - VELOCITY_EMA_ALPHA) + ((nextY - y) / dt) * VELOCITY_EMA_ALPHA
      } else if (dt > 100) {
        vx = 0
        vy = 0
      }
      x = nextX
      y = nextY
      t = at
    },
    read: () => ({ vx, vy })
  }
}

/** Short client-side flick decay that feeds the existing coalesced wheel queue after finger lift. */
export function useBrowserScrollMomentum(args: {
  pageCoveredRef: { current: boolean }
  sendWheel: (point: BrowserPoint, dx: number, dy: number, gestureId: number) => void
}) {
  const { pageCoveredRef, sendWheel } = args
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelMomentum = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => cancelMomentum, [cancelMomentum])

  const startMomentum = useCallback(
    (point: BrowserPoint, initialVx: number, initialVy: number, gestureId: number) => {
      cancelMomentum()
      if (
        !Number.isFinite(initialVx) ||
        !Number.isFinite(initialVy) ||
        pageCoveredRef.current ||
        Math.hypot(initialVx, initialVy) <= MOMENTUM_MIN_START_SPEED
      ) {
        return
      }
      let vx = initialVx
      let vy = initialVy
      let steps = 0
      const step = () => {
        timerRef.current = null
        if (
          pageCoveredRef.current ||
          steps >= MOMENTUM_MAX_STEPS ||
          Math.hypot(vx, vy) < MOMENTUM_MIN_STEP_SPEED
        ) {
          return
        }
        vx *= MOMENTUM_DECAY
        vy *= MOMENTUM_DECAY
        steps += 1
        sendWheel(point, vx * MOMENTUM_STEP_MS, vy * MOMENTUM_STEP_MS, gestureId)
        timerRef.current = setTimeout(step, MOMENTUM_STEP_MS)
      }
      timerRef.current = setTimeout(step, MOMENTUM_STEP_MS)
    },
    [cancelMomentum, pageCoveredRef, sendWheel]
  )

  return { cancelMomentum, startMomentum }
}
