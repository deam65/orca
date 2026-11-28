import { describe, expect, it } from 'vitest'
import {
  createBridgePortPair,
  disposeBridgePortPair
} from '../test-support/bridge-port-pair-test-harness'
import { createFakeRpcClient } from '../../test-support/bridge-host-test-fakes'
import { createBridgeHost } from '../../host-bridge/bridge-host'
import { MOBILE_WEB_SHELL_GRANTS } from '../../routing/page-route-policy'
import {
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_SCREENCAST_FRAME_URL_GRANT
} from '../protocol/bridge-frame-fields'
import { readBridgeHostMessage } from '../protocol/bridge-envelope'
import { MOBILE_BRIDGE_MAX_FRAME_BYTES } from '../../../../../src/shared/mobile-bridge/mobile-bridge-frame-bytes'
import {
  BrowserScreencastOpcode,
  type BrowserScreencastFrame
} from '../../../browser/screencast/browser-screencast-protocol'
import { createBrowserFrameDataUri } from '../../../browser/screencast/browser-frame-data-uri.web'
import { buildMobileBrowserScreencastRequest } from '../../../browser/screencast/browser-screencast-request.web'
import { createBridgeRpcClient } from '../bridge-rpc-client'

function makeFrame(seq: number, byteLength: number): BrowserScreencastFrame {
  const image = new Uint8Array(byteLength)
  image.fill(0xab)
  return {
    opcode: BrowserScreencastOpcode.Frame,
    seq,
    format: 'jpeg',
    metadata: { deviceWidth: 390, deviceHeight: 844, imageWidth: 780, imageHeight: 1688 },
    image
  }
}

function createZeroCopyPair() {
  const rpc = createFakeRpcClient()
  const staged = new Map<string, Uint8Array>()
  const cleared: (string | null)[] = []
  const toPage: string[] = []
  let receiveOnPage: ((json: string) => void) | null = null

  const host = createBridgeHost({
    client: rpc,
    post: (json) => {
      toPage.push(json)
      queueMicrotask(() => receiveOnPage?.(json))
      return Promise.resolve()
    },
    stageScreencastFrame: (streamId, frameSeq, _mime, data) => {
      const url = `/__orca_screencast/${streamId}/${frameSeq}`
      staged.set(url, data)
      return url
    },
    clearScreencastFrames: (streamId) => {
      cleared.push(streamId)
      if (streamId === null) {
        staged.clear()
      } else {
        for (const key of staged.keys()) {
          if (key.startsWith(`/__orca_screencast/${streamId}/`)) {
            staged.delete(key)
          }
        }
      }
    },
    buildId: 'build-a',
    sessionId: 'session-a',
    route: { pathname: '/h/host-a' },
    pageRoutes: ['/h/[hostId]'],
    routeGrants: MOBILE_WEB_SHELL_GRANTS,
    sessionEstablished: false,
    host: { id: 'host-a', name: 'Host A', endpoint: 'ws://host-a', lastConnected: 0 },
    readClientIdentity: () => 'device-a',
    readStorage: () => ({ storage: {}, storageOversize: [] }),
    onStorageWrite: () => {},
    onNavigate: () => {},
    onExternalLink: () => {},
    onHaptic: () => {},
    serveNativeVerb: () => Promise.resolve(null),
    onNavigateBack: () => 'popped',
    onPageFault: () => {},
    onPageReady: () => {},
    onPagePainted: () => {},
    onPageBackClaim: () => {},
    onPageLocation: () => {},
    onRouteParamClear: () => {},
    onRouteRefused: () => {}
  })

  const client = createBridgeRpcClient({
    send: (json) => {
      queueMicrotask(() => host.receive(json))
    },
    onMessage: (handler) => {
      receiveOnPage = handler
      return () => {
        receiveOnPage = null
      }
    }
  })

  const flush = async () => {
    for (let i = 0; i < 12; i += 1) {
      await Promise.resolve()
    }
  }

  return { rpc, host, client, staged, cleared, toPage, flush }
}

describe('zero-copy screencast frameUrl bridge lane', () => {
  it('negotiates screencastFrameUrl, delivers >640KB frames via tiny JSON, and clears on unsubscribe', async () => {
    const { rpc, host, client, staged, cleared, toPage, flush } = createZeroCopyPair()
    await flush()

    expect(client.getShellSession()?.grants.native).toContain(BRIDGE_SCREENCAST_FRAME_URL_GRANT)
    const req = buildMobileBrowserScreencastRequest({ width: 430, height: 932 }, 3, 'mobile', true)
    expect(req?.deviceScaleFactor).toBe(3)
    expect(req?.quality).toBe(85)
    expect(req?.maxWidth).toBe(1290)
    expect(req?.maxHeight).toBe(2796)
    expect(req?.minFrameIntervalMs).toBe(16)

    const reqWeb = buildMobileBrowserScreencastRequest({ width: 393, height: 650 }, 3, 'web', true)
    expect(reqWeb?.quality).toBe(85)
    expect(reqWeb?.maxWidth).toBeGreaterThanOrEqual(1920)

    const reqFallback = buildMobileBrowserScreencastRequest(
      { width: 393, height: 650 },
      3,
      'mobile',
      false
    )
    expect(reqFallback?.quality).toBe(65)
    expect(reqFallback?.deviceScaleFactor).toBeLessThanOrEqual(2)

    const received: BrowserScreencastFrame[] = []
    const unsubscribe = client.subscribe(
      'browser.screencast',
      { worktree: 'id:wt-1', page: 'page-1' },
      () => {},
      { onBinaryFrame: (frame) => received.push(frame) }
    )
    await flush()

    // Larger than the 640KB JSON bridge cap, which base64 delivery would have dropped.
    const bigFrame = makeFrame(7, MOBILE_BRIDGE_MAX_FRAME_BYTES + 128 * 1024)
    rpc.streams[0]!.emitBinary!(bigFrame)
    await flush()

    expect(received).toHaveLength(1)
    expect(received[0]!.seq).toBe(7)
    expect(received[0]!.frameUrl).toMatch(/^\/__orca_screencast\/[A-Za-z0-9_-]{22}\/1$/)
    expect(received[0]!.b64).toBeUndefined()
    expect(createBrowserFrameDataUri(received[0]!)).toBe(received[0]!.frameUrl)
    expect(staged.get(received[0]!.frameUrl!)?.byteLength).toBe(bigFrame.image.byteLength)

    // Reconnect replays frame.seq=7 under the same bridge stream id; monotonic bridge seq prevents URL collision.
    rpc.streams[0]!.emitBinary!(makeFrame(7, 128))
    await flush()
    expect(received).toHaveLength(2)
    expect(received[1]!.seq).toBe(7)
    expect(received[1]!.frameUrl).toMatch(/^\/__orca_screencast\/[A-Za-z0-9_-]{22}\/2$/)
    expect(received[1]!.frameUrl).not.toBe(received[0]!.frameUrl)

    const lastEventJson = toPage[toPage.length - 1]!
    expect(lastEventJson.length).toBeLessThan(350)

    unsubscribe()
    await flush()
    expect(staged.size).toBe(0)
    expect(cleared.length).toBeGreaterThan(0)

    client.close()
    host.dispose()
  })

  it('falls back to base64 without eager atob decode on older shells lacking native staging', async () => {
    const pair = createBridgePortPair({ rpc: createFakeRpcClient() })
    await pair.flush()

    expect(pair.client.getShellSession()?.grants.native).not.toContain(
      BRIDGE_SCREENCAST_FRAME_URL_GRANT
    )

    const received: BrowserScreencastFrame[] = []
    const unsubscribe = pair.client.subscribe(
      'browser.screencast',
      { worktree: 'id:wt-1', page: 'page-1' },
      () => {},
      { onBinaryFrame: (frame) => received.push(frame) }
    )
    await pair.flush()

    pair.rpc.streams[0]!.emitBinary!(makeFrame(2, 64))
    await pair.flush()

    expect(received).toHaveLength(1)
    expect(received[0]!.frameUrl).toBeUndefined()
    expect(typeof received[0]!.b64).toBe('string')
    expect(received[0]!.image.byteLength).toBe(0)
    expect(createBrowserFrameDataUri(received[0]!)).toBe(
      `data:image/jpeg;base64,${received[0]!.b64}`
    )

    unsubscribe()
    await disposeBridgePortPair(pair)
  })

  it('rejects malformed or traversal frameUrl values at the bridge trust boundary', () => {
    const base = {
      v: BRIDGE_PROTOCOL_VERSION,
      type: 'event',
      id: 'aaaaaaaaaaaaaaaaaaaaaa',
      seq: 1
    }
    const invalidUrls = [
      '/__orca_screencast/../secret/0',
      '/__orca_screencast/aaaaaaaaaaaaaaaaaaaaaa/0?x=1',
      '/__orca_screencast/aaaaaaaaaaaaaaaaaaaaaa/0")',
      'javascript:alert(1)',
      'https://evil.example/a.jpg',
      '/__orca_screencast/short/0'
    ]
    for (const frameUrl of invalidUrls) {
      const parsed = readBridgeHostMessage(
        JSON.stringify({
          ...base,
          binary: { frameUrl, format: 'jpeg', frameSeq: 0, metadata: {} }
        })
      )
      expect(parsed).toEqual({ ok: false, refusal: 'unrecognised-message' })
    }
  })
})
