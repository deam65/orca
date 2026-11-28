import {
  Image,
  type ImageInstance,
  type ImageLoadEvent,
  type ImageStyle,
  type StyleProp
} from 'react-native'

export type MobileBrowserFrameLayerImageProps = {
  attachImage: (image: ImageInstance | null) => void
  source: { uri: string }
  resizeMode: 'stretch' | 'contain'
  onLoad: (event: ImageLoadEvent) => void
  onError: () => void
  style: StyleProp<ImageStyle>
}

export function MobileBrowserFrameLayerImage({
  attachImage,
  source,
  resizeMode,
  onLoad,
  onError,
  style
}: MobileBrowserFrameLayerImageProps) {
  return (
    <Image
      ref={attachImage}
      source={source}
      resizeMode={resizeMode}
      fadeDuration={0}
      onLoad={onLoad}
      onError={onError}
      style={style}
    />
  )
}
