import {
  BrowserScreencastOpcode,
  type BrowserScreencastFrame
} from '../../../browser/screencast/browser-screencast-protocol'
import type { BridgeHostMessage } from '../protocol/bridge-envelope'

// Decode only base64 image bytes; format/frameSeq/metadata already cross in JSON, so no socket wire header needs parsing.
export type BridgeBinaryEvent = Extract<
  Extract<BridgeHostMessage, { type: 'event' }>,
  { binary: unknown }
>['binary']

const EMPTY_IMAGE = new Uint8Array(0)

export function decodeBridgeScreencastFrame(
  event: BridgeBinaryEvent
): BrowserScreencastFrame | null {
  if ('frameUrl' in event) {
    return {
      opcode: BrowserScreencastOpcode.Frame,
      seq: event.frameSeq,
      format: event.format,
      metadata: event.metadata,
      image: EMPTY_IMAGE,
      frameUrl: event.frameUrl
    }
  }
  if (!event.b64 || typeof event.b64 !== 'string') {
    return null
  }
  return {
    opcode: BrowserScreencastOpcode.Frame,
    seq: event.frameSeq,
    format: event.format,
    metadata: event.metadata,
    image: EMPTY_IMAGE,
    b64: event.b64
  }
}
