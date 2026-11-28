import { View } from 'react-native'
import { FolderTree } from 'lucide-react-native'
import { useMobileTranslation } from '../../../i18n/use-mobile-translation'
import { HostKindIcon } from '../../../components/icons/HostKindIcon'
import {
  LIST_LEADING_INSET,
  ListGroup,
  SectionHeader,
  ListRow
} from '../../../components/list/ListGroup'
import { newWorktreeFormStylesSheet } from './new-worktree-form-styles'
import { useThemedStyles } from '../../../theme/themed-styles'
import { useMobileColors } from '../../../theme/use-mobile-color-scheme'

type Selection = { label: string; detail?: string }

/** The form's "Where" group: which project or folder, and which host it runs on. */
export function NewWorktreeProjectTargetFields({
  project,
  runTarget,
  projectBadgeColor,
  isFolderTarget = false,
  canPickRunTarget,
  onOpenProject,
  onOpenRunTarget
}: {
  project: Selection | null
  runTarget: (Selection & { hostId: string }) | null
  projectBadgeColor: string | null
  isFolderTarget?: boolean
  canPickRunTarget?: boolean
  onOpenProject: () => void
  onOpenRunTarget: () => void
}) {
  const styles = useThemedStyles(newWorktreeFormStylesSheet)
  const colors = useMobileColors()
  const t = useMobileTranslation()
  const projectTitle = t('components.newWorktreeProjectTargetFields.project', 'Project')
  const runOnTitle = t('components.newWorktreeProjectTargetFields.runOn', 'Run on')
  const projectValue =
    project?.label ??
    t('components.newWorktreeProjectTargetFields.selectProject', 'Select a project')
  const runTargetValue =
    runTarget?.label ??
    t('components.newWorktreeProjectTargetFields.selectRunTarget', 'Select a run target')
  const runTargetNavigable = canPickRunTarget ?? project !== null
  return (
    <>
      <SectionHeader title={t('components.newWorktreeProjectTargetFields.where', 'Where')} first />
      <ListGroup separatorInset={LIST_LEADING_INSET}>
        <ListRow
          key="project"
          title={projectTitle}
          leading={
            isFolderTarget ? (
              <FolderTree size={16} color={projectBadgeColor ?? colors.textSecondary} />
            ) : projectBadgeColor ? (
              <View style={[styles.repoDot, { backgroundColor: projectBadgeColor }]} />
            ) : null
          }
          value={projectValue}
          navigates
          onPress={onOpenProject}
          accessibilityLabel={`${projectTitle}, ${projectValue}`}
        />
        <ListRow
          key="runTarget"
          title={runOnTitle}
          leading={<HostKindIcon hostId={runTarget?.hostId} size={18} />}
          value={runTargetValue}
          navigates={runTargetNavigable}
          // A run target belongs to a project; folder groups are pinned to their single host.
          disabled={!runTargetNavigable}
          onPress={runTargetNavigable ? onOpenRunTarget : undefined}
          accessibilityLabel={`${runOnTitle}, ${runTargetValue}`}
        />
      </ListGroup>
    </>
  )
}
