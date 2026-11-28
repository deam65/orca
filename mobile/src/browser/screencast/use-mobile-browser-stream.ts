import { translate } from '../../i18n/mobile-i18n'
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { PixelRatio } from 'react-native'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import type { BrowserScreencastFrameMetadata } from './browser-screencast-protocol'
import { buildMobileBrowserScreencastRequest } from './browser-screencast-request'
import type { MobileBrowserViewMode } from './browser-screencast-request-parameters'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  browserFrameMetadataEqual,
  cacheBrowserFrame,
  getCachedBrowserFrame
} from './mobile-browser-frame-state'
import {
  clampBrowserZoomState,
  computeBrowserFrameGeometry,
  type BrowserTouchLayout,
  type BrowserZoomState
} from '../page-interaction/browser-touch-geometry'
import type { MobileBrowserTab } from '../../session/tabs/mobile-session-tabs'
import {
  handleBrowserScreencastEvent,
  readScreencastReady,
  type BrowserDialogState,
  type ScreencastEvent
} from './mobile-browser-stream-events'
import { createBrowserScreencastAckSender } from './browser-screencast-ack-sender'
import { createBrowserFramePacer } from './browser-frame-pacer'
import { useMobileBrowserRequest } from '../page-interaction/use-mobile-browser-request'

type MobileBrowserStreamArgs = {
  binaryScreencastGranted: boolean
  screencastFrameUrlGranted?: boolean
  browserViewMode: MobileBrowserViewMode
  busyRef: { current: boolean }
  cacheKey: string | null
  client: RpcClient | null
  frameMetadata: BrowserScreencastFrameMetadata | null
  frameMetadataRef: { current: BrowserScreencastFrameMetadata | null }
  foregroundVisit: number | null
  initialFrameUri: string | null
  lastStreamCacheKeyRef: { current: string | null }
  lastZoomResetUrlRef: { current: string }
  layout: BrowserTouchLayout | null
  resetBrowserZoomState: () => void
  screencastSupported: boolean | null
  setAddressValue: Dispatch<SetStateAction<string>>
  setBusy: Dispatch<SetStateAction<boolean>>
  setDialog: Dispatch<SetStateAction<BrowserDialogState | null>>
  pagePromptsSupported: boolean
  handlePageEvent: (payload: unknown) => boolean
  clearPagePrompt: () => void
  setError: Dispatch<SetStateAction<string | null>>
  setFrameMetadata: Dispatch<SetStateAction<BrowserScreencastFrameMetadata | null>>
  setZoom: Dispatch<SetStateAction<BrowserZoomState>>
  streamGenerationRef: { current: number }
  tab: MobileBrowserTab
  worktreeId: string
  zoomRef: { current: BrowserZoomState }
}

export function useMobileBrowserStream(args: MobileBrowserStreamArgs) {
  const {
    binaryScreencastGranted,
    screencastFrameUrlGranted = false,
    browserViewMode,
    busyRef,
    cacheKey,
    client,
    frameMetadata,
    frameMetadataRef,
    foregroundVisit,
    initialFrameUri,
    lastStreamCacheKeyRef,
    lastZoomResetUrlRef,
    layout,
    resetBrowserZoomState,
    screencastSupported,
    setAddressValue,
    setBusy,
    setDialog,
    pagePromptsSupported,
    handlePageEvent,
    clearPagePrompt,
    setError,
    setFrameMetadata,
    setZoom,
    streamGenerationRef,
    tab,
    worktreeId,
    zoomRef
  } = args

  const { pageParams, sendBrowserRequest } = useMobileBrowserRequest({
    busyRef,
    client,
    pageId: tab.browserPageId,
    setBusy,
    setError,
    worktreeId
  })

  const [frameUri, setFrameUri] = useState(initialFrameUri)
  const [streamStopped, setStreamStopped] = useState<string | null>(null)
  const [reconnectRequest, setReconnectRequest] = useState(0)
  const [ackSender] = useState(createBrowserScreencastAckSender)
  const [framePacer] = useState(() =>
    createBrowserFramePacer({
      initialUri: initialFrameUri,
      setFrameUri,
      onShown: ({ frame, cacheKey: shownCacheKey, uri }) => {
        cacheBrowserFrame(shownCacheKey, { uri, metadata: frame.metadata })
        if (!browserFrameMetadataEqual(frameMetadataRef.current, frame.metadata)) {
          frameMetadataRef.current = frame.metadata
          setFrameMetadata(frame.metadata)
        }
        if (busyRef.current) {
          busyRef.current = false
          setBusy(false)
        }
        ackSender.noteShown(frame.seq)
      }
    })
  )

  const streamRequest = useMemo(
    () =>
      buildMobileBrowserScreencastRequest(
        layout,
        PixelRatio.get(),
        browserViewMode,
        screencastFrameUrlGranted
      ),
    [browserViewMode, layout, screencastFrameUrlGranted]
  )

  const frameGeometry = useMemo(
    () => computeBrowserFrameGeometry(layout, frameMetadata),
    [frameMetadata, layout]
  )

  useEffect(() => {
    if (!frameGeometry) {
      return
    }
    setZoom((current) => {
      const next = clampBrowserZoomState(current, frameGeometry, MIN_ZOOM, MAX_ZOOM)
      if (
        next.scale === current.scale &&
        next.offsetX === current.offsetX &&
        next.offsetY === current.offsetY
      ) {
        return current
      }
      zoomRef.current = next
      return next
    })
  }, [frameGeometry])

  useEffect(() => {
    streamGenerationRef.current += 1
    const generation = streamGenerationRef.current
    const sameStream = Boolean(cacheKey) && lastStreamCacheKeyRef.current === cacheKey
    lastStreamCacheKeyRef.current = cacheKey
    if (sameStream && framePacer.hasFrame()) {
      framePacer.reset()
    } else {
      const cachedFrame = getCachedBrowserFrame(cacheKey)
      framePacer.replace(cachedFrame?.uri ?? null)
      frameMetadataRef.current = cachedFrame?.metadata ?? null
      setFrameMetadata(cachedFrame?.metadata ?? null)
    }
    setDialog(null)
    clearPagePrompt()
    setError(null)
    setStreamStopped(null)
    if (
      !client ||
      !binaryScreencastGranted ||
      screencastSupported !== true ||
      !tab.browserPageId ||
      foregroundVisit === null ||
      !streamRequest
    ) {
      busyRef.current = false
      setBusy(false)
      if (!binaryScreencastGranted) {
        setError(
          translate('browser.stream.updateApp', 'Update the Orca app to stream browser tabs here.')
        )
      } else if (screencastSupported === false) {
        setError(
          translate('browser.stream.hostCannotStream', "This host can't stream browser tabs here.")
        )
      } else if (screencastSupported === null) {
        setError(
          translate('browser.stream.checking', 'Checking desktop browser streaming support.')
        )
      } else if (!tab.browserPageId) {
        setError(translate('browser.stream.pageUnavailable', 'Browser page is not available yet.'))
      }
      return
    }
    busyRef.current = true
    setBusy(true)
    let timedOut = false
    let startupTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      if (streamGenerationRef.current !== generation) {
        return
      }
      timedOut = true
      busyRef.current = false
      setBusy(false)
      setStreamStopped(translate('browser.stream.timedOut', 'Browser stream timed out.'))
    }, 15_000)
    const clearStartupTimer = (): void => {
      if (startupTimer) {
        clearTimeout(startupTimer)
        startupTimer = null
      }
    }
    const worktree = `id:${worktreeId}`
    ackSender.bind(client, worktree)

    const unsubscribe = client.subscribe(
      'browser.screencast',
      {
        worktree,
        page: tab.browserPageId,
        ...streamRequest,
        frameAck: 1,
        ...(pagePromptsSupported ? { pagePrompts: 1 } : {}),
        downloads: 1
      },
      (payload) => {
        if (streamGenerationRef.current !== generation) {
          return
        }
        const ready = readScreencastReady(payload)
        if (ready) {
          ackSender.setSubscriptionId(ready.frameAck === true ? ready.subscriptionId : null)
        }
        if (handlePageEvent(payload)) {
          return
        }
        handleBrowserScreencastEvent({
          busyRef,
          clearStartupTimer,
          event: payload as ScreencastEvent,
          lastZoomResetUrlRef,
          resetBrowserZoomState,
          setAddressValue,
          setBusy,
          setDialog,
          setStreamStopped
        })
      },
      {
        onBinaryFrame: (frame) => {
          if (streamGenerationRef.current !== generation) {
            return
          }
          clearStartupTimer()
          if (timedOut) {
            timedOut = false
            setStreamStopped(null)
          }
          if (cacheKey) {
            framePacer.push(frame, cacheKey)
          }
        }
      }
    )
    return () => {
      clearStartupTimer()
      framePacer.reset()
      ackSender.reset()
      unsubscribe()
    }
  }, [
    ackSender,
    binaryScreencastGranted,
    clearPagePrompt,
    client,
    foregroundVisit,
    handlePageEvent,
    pagePromptsSupported,
    framePacer,
    reconnectRequest,
    resetBrowserZoomState,
    screencastSupported,
    streamRequest,
    cacheKey,
    tab.browserPageId,
    worktreeId
  ])

  const renderedFrameSource = frameUri ? { uri: frameUri } : null

  return {
    frameGeometry,
    frameLayers: framePacer.layers,
    pageParams,
    reconnectStream: () => setReconnectRequest((current) => current + 1),
    renderedFrameSource,
    sendBrowserRequest,
    streamStopped
  }
}
