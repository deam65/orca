import { utf8ByteLength } from '../bridge/protocol/bridge-caps'
import { BRIDGE_PROTOCOL_VERSION } from '../bridge/protocol/bridge-frame-fields'
import {
  bridgeScreencastBase64Length,
  bridgeScreencastFrameHeader,
  encodeBridgeScreencastFrame,
  encodeBridgeScreencastFrameUrl
} from '../bridge/screencast/bridge-screencast-encoder'
import type { BridgeBinaryEvent } from '../bridge/screencast/bridge-screencast-binary'
import type { BrowserScreencastFrame } from '../../browser/screencast/browser-screencast-protocol'

export type ScreencastFrameStager = (
  streamId: string,
  frameSeq: number,
  mimeType: 'image/jpeg' | 'image/png',
  data: Uint8Array
) => string | null

export type ScreencastFrameDeliveryPlan =
  | { kind: 'send'; json: string }
  | { kind: 'drop'; bytes: number }

function binaryEventJson(id: string, seq: number, binary: BridgeBinaryEvent): string {
  return JSON.stringify({ v: BRIDGE_PROTOCOL_VERSION, type: 'event', id, seq, binary })
}

/** Prefer native zero-copy frame URLs when negotiated; fall back to cap-checked base64. */
export function prepareBridgeScreencastFrame(args: {
  id: string
  seq: number
  frame: BrowserScreencastFrame
  canUseFrameUrls?: () => boolean
  stageScreencastFrame?: ScreencastFrameStager
  windowHasRoom: () => boolean
  canCarry: (bytes: number) => boolean
}): ScreencastFrameDeliveryPlan {
  const { id, seq, frame, canUseFrameUrls, stageScreencastFrame, windowHasRoom, canCarry } = args
  if (canUseFrameUrls?.() && stageScreencastFrame) {
    if (!windowHasRoom()) {
      return { kind: 'drop', bytes: 0 }
    }
    // Key URLs by monotonic bridge seq (not frame.seq) so reconnects never collide under the same stream id.
    const estimatedBytes = utf8ByteLength(
      binaryEventJson(
        id,
        seq,
        encodeBridgeScreencastFrameUrl(frame, `/__orca_screencast/${id}/${seq}`)
      )
    )
    if (!canCarry(estimatedBytes)) {
      return { kind: 'drop', bytes: estimatedBytes }
    }
    const mimeType = frame.format === 'png' ? 'image/png' : 'image/jpeg'
    let frameUrl: string | null = null
    try {
      frameUrl = stageScreencastFrame(id, seq, mimeType, frame.image)
    } catch {
      frameUrl = null
    }
    if (frameUrl !== null) {
      const json = binaryEventJson(id, seq, encodeBridgeScreencastFrameUrl(frame, frameUrl))
      const bytes = utf8ByteLength(json)
      return canCarry(bytes) ? { kind: 'send', json } : { kind: 'drop', bytes }
    }
  }
  // Measure envelope plus exact ASCII base64 length before encoding; a closed window must not pay for full-image passes on discarded frames.
  const bytes =
    utf8ByteLength(binaryEventJson(id, seq, bridgeScreencastFrameHeader(frame))) +
    bridgeScreencastBase64Length(frame.image.byteLength)
  if (!canCarry(bytes)) {
    return { kind: 'drop', bytes }
  }
  return { kind: 'send', json: binaryEventJson(id, seq, encodeBridgeScreencastFrame(frame)) }
}
