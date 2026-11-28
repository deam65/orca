import type { RpcClient } from '../../transport/rpc/rpc-client-contract'

const ACK_MIN_INTERVAL_MS = 32

export type BrowserScreencastAckSender = {
  bind: (client: RpcClient | null, worktree: string) => void
  setSubscriptionId: (subscriptionId: string | null) => void
  noteShown: (seq: number) => void
  reset: () => void
}

/** Coalesces cumulative post-decode frame acks to at most one in-flight RPC every ~32ms. */
export function createBrowserScreencastAckSender(): BrowserScreencastAckSender {
  let activeClient: RpcClient | null = null
  let activeWorktree = ''
  let activeSubscriptionId: string | null = null
  let generation = 0
  let latestShownSeq = 0
  let lastAckedSeq = 0
  let inFlight = false
  let lastSentAt = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const flush = (): void => {
    if (!activeClient || !activeSubscriptionId || inFlight || latestShownSeq <= lastAckedSeq) {
      return
    }
    const elapsed = Date.now() - lastSentAt
    if (elapsed < ACK_MIN_INTERVAL_MS) {
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null
          flush()
        }, ACK_MIN_INTERVAL_MS - elapsed)
      }
      return
    }
    const seq = latestShownSeq
    const currentGen = generation
    const client = activeClient
    const params = {
      worktree: activeWorktree,
      subscriptionId: activeSubscriptionId,
      seq
    }
    inFlight = true
    lastSentAt = Date.now()
    void client
      .sendRequest('browser.screencast.ack', params)
      .then(() => {
        if (currentGen === generation) {
          lastAckedSeq = Math.max(lastAckedSeq, seq)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (currentGen !== generation) {
          return
        }
        inFlight = false
        if (latestShownSeq > lastAckedSeq) {
          flush()
        }
      })
  }

  return {
    bind: (client, worktree) => {
      clearTimer()
      generation += 1
      activeClient = client
      activeWorktree = worktree
      activeSubscriptionId = null
      latestShownSeq = 0
      lastAckedSeq = 0
      inFlight = false
      lastSentAt = 0
    },
    setSubscriptionId: (subscriptionId) => {
      activeSubscriptionId = subscriptionId
      flush()
    },
    noteShown: (seq) => {
      latestShownSeq = Math.max(latestShownSeq, seq)
      flush()
    },
    reset: () => {
      clearTimer()
      generation += 1
      activeClient = null
      activeSubscriptionId = null
      latestShownSeq = 0
      lastAckedSeq = 0
      inFlight = false
    }
  }
}
