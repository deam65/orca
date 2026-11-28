import type { BrowserScreencastFrame } from '../../../browser/screencast/browser-screencast-protocol'
import type { BridgeBinaryEvent } from './bridge-screencast-binary'
import { encodeBase64Bytes } from '../../../transport/encryption/base64-byte-codec'

// Encode image bytes only; JSON already carries frame metadata, and the page reconstructs the native listener shape without a socket header.
export function encodeBridgeScreencastFrame(frame: BrowserScreencastFrame): BridgeBinaryEvent {
  return { ...bridgeScreencastFrameHeader(frame), b64: encodeBase64(frame.image) }
}

export function encodeBridgeScreencastFrameUrl(
  frame: BrowserScreencastFrame,
  frameUrl: string
): BridgeBinaryEvent {
  return {
    frameUrl,
    format: frame.format,
    frameSeq: frame.seq,
    metadata: frame.metadata
  }
}

// Build encoding from this image-free envelope so measurement cannot drift. ASCII base64 adds exactly its known length, allowing cap checks before the full-image pass.
export function bridgeScreencastFrameHeader(frame: BrowserScreencastFrame): BridgeBinaryEvent {
  return {
    b64: '',
    format: frame.format,
    // Use screencast frameSeq; bridge seq belongs to acknowledgement/backpressure.
    frameSeq: frame.seq,
    metadata: frame.metadata
  }
}

export function bridgeScreencastBase64Length(imageByteLength: number): number {
  return Math.ceil(imageByteLength / 3) * 4
}

export function encodeBase64(bytes: Uint8Array): string {
  return encodeBase64Bytes(bytes)
}
