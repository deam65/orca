import { Platform, StyleSheet, type ViewStyle } from 'react-native'
import { COMPOSER_TEXT_SIZE } from '../../components/composer-input/composer-input-styles'
import { radii, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: RN Web forwards CSS touchAction and userSelect on ViewStyle; native ignores this branch.
const WEB_VIEWPORT_TOUCH_STYLE = { touchAction: 'none', userSelect: 'none' } as ViewStyle

export const mobileBrowserPaneStylesSheet = themedStyleSheet((colors) => ({
  root: {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.bgBase
  },
  viewport: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    backgroundColor: colors.bgBase,
    ...(Platform.OS === 'web' ? WEB_VIEWPORT_TOUCH_STYLE : {})
  },
  browserImageHost: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden'
  },
  browserImageFill: {
    width: '100%',
    height: '100%'
  },
  browserImageLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center'
  },
  browserImageLayerHidden: {
    opacity: 0
  },
  browserZoomOffset: {
    alignItems: 'center',
    justifyContent: 'center'
  },
  browserFrameBox: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden'
  },
  browserImage: {
    backgroundColor: colors.bgBase
  },
  // Only the spinner or the reason; no scrim, which read as a grey wash over a light page.
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm
  },
  errorText: {
    color: colors.textPrimary,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 13,
    textAlign: 'center',
    overflow: 'hidden'
  },
  // One line like desktop's stream toast: the reason, then Reconnect.
  streamStopped: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.surface,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    maxWidth: '100%'
  },
  streamStoppedText: {
    flexShrink: 1,
    color: colors.textPrimary,
    fontSize: 13
  },
  // The hidden field the keyboard types into, at the size the page never zooms to.
  liveInput: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: 1,
    height: 1,
    opacity: 0,
    fontSize: COMPOSER_TEXT_SIZE
  },
  promptLine: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    lineHeight: 20,
    marginTop: spacing.xs
  },
  promptFields: {
    gap: spacing.sm,
    marginTop: spacing.md
  },
  dialogError: {
    color: colors.statusRed,
    fontSize: typography.metaSize,
    lineHeight: 18,
    marginTop: spacing.sm
  }
}))
