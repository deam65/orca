import type { MobileBrowserFrameLayerImageProps } from './MobileBrowserFrameLayerImage'

// Render a plain <img> so React never overwrites pacer-managed frame URLs and decode() runs once.
export function MobileBrowserFrameLayerImage({
  attachImage,
  resizeMode
}: MobileBrowserFrameLayerImageProps) {
  return (
    <img
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: on RN Web, ImageInstance refs hold the underlying DOM HTMLImageElement read by browser-frame-layer-paint.web.ts.
      ref={attachImage as never}
      alt=""
      draggable={false}
      decoding="async"
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        objectFit: resizeMode === 'contain' ? 'contain' : 'fill',
        pointerEvents: 'none',
        userSelect: 'none'
      }}
    />
  )
}
