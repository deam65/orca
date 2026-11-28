import { useEffect, useMemo, useRef, useState } from 'react'
import { Keyboard } from 'react-native'
import { getComposerRepoWorktreeBranches } from '../../../../../src/shared/new-workspace/composer-branch-selection'
import type { ProjectGroup } from '../../../../../src/shared/project/groups/project-group-types'
import { shouldPreserveWorkspaceSourceOnRepoChange } from '../../../../../src/shared/new-workspace/workspace-source'
import { useMobileTranslation } from '../../../i18n/use-mobile-translation'
import type { SmartModeAvailabilityInput } from '../../source-selection/mobile-smart-source-modes'
import { useMobileComposerSource } from '../../source-selection/use-mobile-composer-source'
import { useNewWorktreeRuntimeCapabilities } from '../worktree-create-capability'
import { useWorktreeCreateBasePrefetch } from '../use-worktree-create-base-prefetch'
import { useHostDescriptor } from '../../../host-descriptors/host-descriptor-store'
import { isSameMobileWorkspaceRepo } from '../../../worktree/repositories/new-workspace-dialog-repo-selection'
import {
  buildRetiredWorktreeNamesRefreshKey,
  useRetiredWorktreeNames
} from '../../../worktree/catalog/use-retired-worktree-names'
import { durableDraftRowKey } from '../../../drafts/durable-draft-rows'
import { useDurableDraftField } from '../../../drafts/durable-draft-fields'
import { BottomDrawerModalHost } from '../../../components/bottom-drawer/bottom-drawer-modal-host'
import {
  getMobileWorkspaceRepoBadgeColor,
  type MobileWorkspaceRepo,
  type NewWorktreeModalProps
} from '../forms/new-worktree-modal-types'
import {
  resolveNewWorkspaceTargetView,
  serverOfWorkspaceTarget
} from '../../source-selection/presentation/new-workspace-project-targets'
import { NewWorktreeFormSheet } from '../forms/NewWorktreeFormSheet'
import { NewWorktreeModalDrawers } from './NewWorktreeModalDrawers'
import { useNewWorkspaceAgentSelection } from '../runtime/use-new-workspace-agent-selection'
import { useNewWorkspaceCreateSubmit } from '../runtime/use-new-workspace-create-submit'
import { useNewWorkspaceExecutionTarget } from '../runtime/use-new-workspace-execution-target'
import {
  isSameMobileProjectGroup,
  useNewWorkspaceProjectGroups
} from '../runtime/use-new-workspace-project-groups'
import { useNewWorkspaceRepositories } from '../runtime/use-new-workspace-repositories'
import { useNewWorkspaceRuntimeContext } from '../runtime/use-new-workspace-runtime-context'
import { useNewWorkspaceSetupScript } from '../runtime/use-new-workspace-setup-script'
import { useNewWorktreeDrawerNavigation } from './use-new-worktree-drawer-navigation'

export function NewWorktreeModal(props: NewWorktreeModalProps) {
  // Remount fresh form before paint per committed opening. Use state, not render-mutated ref counter: react-freeze may discard opening renders.
  const [session, setSession] = useState({ openEpoch: 0, visible: props.visible })
  if (session.visible !== props.visible) {
    setSession({
      openEpoch: props.visible ? session.openEpoch + 1 : session.openEpoch,
      visible: props.visible
    })
  }

  // Key by host, not client: reconnect swaps RpcClient without ending form session and must not erase picked source. Client-scoped hooks discard superseded responses.
  return <NewWorktreeModalContent key={`${session.openEpoch}:${props.hostId}`} {...props} />
}

function NewWorktreeModalContent(props: NewWorktreeModalProps) {
  const t = useMobileTranslation()
  const {
    visible,
    client: desktopClient,
    hostCapabilities,
    serverClients,
    hostId,
    hostLabelById,
    existingWorktreePaths,
    existingWorktrees,
    openExternalUrl,
    onCreated,
    onClose,
    folderLaunch
  } = props
  const {
    repos,
    allRepos,
    selectedRepo: pickedOrDefaultRepo,
    setSelectedRepo,
    loading: loadingRepos,
    loadError: repoLoadError,
    retryLoad
  } = useNewWorkspaceRepositories({
    client: desktopClient,
    serverClients,
    hostId,
    visible,
    ...(folderLaunch
      ? {
          initialRepo: { id: folderLaunch.repoId, executionHostId: folderLaunch.executionHostId }
        }
      : {})
  })
  const {
    projectGroups,
    selectedProjectGroup,
    setSelectedProjectGroup,
    loading: loadingProjectGroups
  } = useNewWorkspaceProjectGroups({
    client: desktopClient,
    serverClients,
    desktopCapabilities: hostCapabilities,
    visible,
    disabled: Boolean(folderLaunch),
    autoSelectFirst: repos.length === 0 && !loadingRepos
  })
  const selectedRepo = selectedProjectGroup ? null : pickedOrDefaultRepo
  const activeTarget = selectedProjectGroup ?? selectedRepo
  const hasTargets = repos.length > 0 || projectGroups.length > 0
  const loading = (loadingRepos || loadingProjectGroups) && !hasTargets
  const loadError = hasTargets ? null : repoLoadError
  // Route picked-target operations to its host; desktop settings/accounts stay on desktop.
  const repoServer = activeTarget ? serverOfWorkspaceTarget(activeTarget) : undefined
  const client = repoServer ? (serverClients?.get(repoServer) ?? null) : desktopClient
  const navigation = useNewWorktreeDrawerNavigation(visible)
  // Kept per desktop until a create succeeds, and read only once the form shows. The host is in the key
  // because the tablet sidebar's native host list has no shell to bind it.
  const [note, setNote] = useDurableDraftField(
    visible ? durableDraftRowKey('workspaceCreate', '', hostId ?? '') : null,
    'note'
  )
  const [error, setError] = useState('')
  const runtime = useNewWorkspaceRuntimeContext(client, visible, hostId, repoServer)
  const repoRuntime = useNewWorktreeRuntimeCapabilities(client, visible)
  const {
    tasksSupported,
    getWorktreeCreateCutoverSupport,
    getAgentLaunchSupport,
    getBranchIntentSupport
  } = repoRuntime
  // The desktop's own run target is named for the desktop, whichever host the picked repo is on.
  const desktopPlatform = useHostDescriptor(hostId)?.platform ?? null
  const hostPlatform = repoServer ? desktopPlatform : repoRuntime.hostPlatform
  const selectedRepoConnectionId = activeTarget?.connectionId ?? null
  const executionTarget = useNewWorkspaceExecutionTarget({
    client,
    connectionId: selectedRepoConnectionId,
    repoId: selectedRepo?.id,
    visible
  })
  const setupScript = useNewWorkspaceSetupScript({ client, selectedRepo, selectedProjectGroup })
  // A kept note opens Options until the user folds them, so it isn't sent unseen.
  const [noteOptions, setNoteOptions] = useState<'closed' | 'open' | 'folded'>('closed')
  if (note && noteOptions === 'closed') {
    setNoteOptions('open')
  }
  const showOptions = setupScript.showAdvanced || (!selectedProjectGroup && noteOptions === 'open')
  const selectedRepoWorktreeBranches = useMemo(
    () => getComposerRepoWorktreeBranches(existingWorktrees ?? [], selectedRepo?.id ?? null),
    [existingWorktrees, selectedRepo]
  )
  const composer = useMobileComposerSource({
    client,
    selectedRepoId: selectedRepo?.id ?? null,
    worktreeBranches: selectedRepoWorktreeBranches,
    onError: setError
  })
  // The folder's name, seeded once per opening; the user's edits stand.
  const seededFolderName = useRef(false)
  useEffect(() => {
    if (folderLaunch && !seededFolderName.current) {
      seededFolderName.current = true
      composer.setName(folderLaunch.name)
    }
  }, [composer, folderLaunch])
  const selectedRepoIsGit = selectedProjectGroup
    ? false
    : selectedRepo
      ? selectedRepo.kind !== 'folder'
      : true
  useWorktreeCreateBasePrefetch({
    client: visible ? client : null,
    repoId: selectedRepo?.id ?? null,
    repoIsGit: selectedRepoIsGit,
    selection: composer.createSelection
  })
  const agentSelection = useNewWorkspaceAgentSelection({
    visible,
    runtimeSettings: runtime.runtimeSettings,
    detectedAgentIds: executionTarget.detectedAgentIds
  })
  const retiredNamesRefreshKey = useMemo(
    () => buildRetiredWorktreeNamesRefreshKey(existingWorktreePaths),
    [existingWorktreePaths]
  )
  const retiredWorktreeNames = useRetiredWorktreeNames(
    client,
    selectedRepo?.id,
    retiredNamesRefreshKey
  )
  const createSubmit = useNewWorkspaceCreateSubmit({
    client,
    repos: allRepos,
    selectedRepo,
    selectedProjectGroup,
    selectedAgent: agentSelection.selectedAgent,
    setSelectedAgent: agentSelection.setSelectedAgent,
    setAgentOverridden: agentSelection.setAgentOverridden,
    runtimeSettings: runtime.runtimeSettings,
    setRuntimeSettings: runtime.setRuntimeSettings,
    detectedAgentIds: executionTarget.detectedAgentIds,
    sshGate: executionTarget.sshGate,
    composer,
    note,
    existingWorktreePaths,
    retiredWorktreeNames,
    setupCommand: setupScript.setupCommand,
    setupRunPolicy: setupScript.setupRunPolicy,
    setupDecisionChoice: setupScript.setupDecisionChoice,
    runSetup: setupScript.runSetup,
    setupWait: setupScript.waitForSetupChoice,
    trustedOrcaHooks: runtime.trustedOrcaHooks,
    setTrustedOrcaHooks: runtime.setTrustedOrcaHooks,
    getWorktreeCreateCutoverSupport,
    getBranchIntentSupport,
    getAgentLaunchSupport,
    transitionDrawer: navigation.transitionDrawer,
    setError,
    onCreated: (worktreeId, name, warning) => {
      // A note typed in a reopened form while this create ran is not the one it sent.
      if (!selectedProjectGroup) {
        setNote((current) => (current === note ? '' : current))
      }
      onCreated(worktreeId, name, warning, repoServer)
    },
    onClose,
    ...(folderLaunch
      ? {
          folderLaunch: {
            ...folderLaunch.submit,
            executionHostId: folderLaunch.executionHostId,
            parent: {
              parentWorkspace: folderLaunch.parentWorkspace,
              parentWorkspaceOrigin: 'manual' as const
            }
          }
        }
      : {})
  })

  const sourceAvailability: SmartModeAvailabilityInput = {
    textOnly: activeTarget != null && !selectedRepoIsGit,
    tasksSupported,
    hasRepo: selectedRepo != null,
    githubAvailable: runtime.availableProviders.includes('github'),
    gitlabAvailable: runtime.availableProviders.includes('gitlab'),
    linearAvailable: runtime.availableProviders.includes('linear'),
    jiraAvailable: runtime.jiraConnection.connected && runtime.availableProviders.includes('jira')
  }
  const targetView = useMemo(
    () =>
      resolveNewWorkspaceTargetView({
        repos,
        projectGroups,
        selectedRepo,
        selectedProjectGroup,
        repoServer,
        hostPlatform,
        hostLabelById
      }),
    [
      hostLabelById,
      hostPlatform,
      projectGroups,
      repoServer,
      repos,
      selectedProjectGroup,
      selectedRepo
    ]
  )
  const needsSetupChoice = Boolean(setupScript.setupCommand) && setupScript.setupRunPolicy === 'ask'
  const canCreate =
    activeTarget != null &&
    !createSubmit.creating &&
    !executionTarget.sshGate.requiresConnection &&
    (!needsSetupChoice || setupScript.setupDecisionChoice != null)
  const projectBadgeColor = selectedProjectGroup
    ? (selectedProjectGroup.color ?? null)
    : selectedRepo
      ? getMobileWorkspaceRepoBadgeColor(selectedRepo)
      : null
  const selectedTargetName =
    selectedProjectGroup?.name ??
    selectedRepo?.displayName ??
    t('components.newWorktreeModal.remoteRepository', 'Remote repository')

  function openPicker(view: 'project' | 'runTarget' | 'agent'): void {
    Keyboard.dismiss()
    navigation.transitionDrawer(view)
  }

  function selectRepo(repo: MobileWorkspaceRepo, clearRepoScopedSource: boolean): void {
    const repoChanged =
      selectedProjectGroup !== null ||
      !selectedRepo ||
      !isSameMobileWorkspaceRepo(repo, selectedRepo)
    setSelectedProjectGroup(null)
    setSelectedRepo(repo)
    if (
      clearRepoScopedSource &&
      repoChanged &&
      !shouldPreserveWorkspaceSourceOnRepoChange(composer.linkedWorkItem)
    ) {
      composer.handleClearSmartNameSelection()
    }
  }

  function selectProjectGroup(group: ProjectGroup): void {
    const changed = !selectedProjectGroup || !isSameMobileProjectGroup(group, selectedProjectGroup)
    setSelectedProjectGroup(group)
    if (changed) {
      composer.handleClearSmartNameSelection()
    }
  }

  function requestClose(): void {
    if (navigation.drawerView === 'form') {
      onClose()
    } else if (navigation.drawerView === 'trust') {
      createSubmit.closeSetupTrust()
    } else {
      navigation.transitionDrawer('form')
    }
  }

  return (
    <BottomDrawerModalHost visible={visible} onRequestClose={requestClose}>
      <NewWorktreeFormSheet
        visible={navigation.formSheetVisible}
        interactive={navigation.formSheetInteractive}
        loading={loading}
        hasRepos={hasTargets}
        loadError={loadError}
        onRetryLoad={retryLoad}
        project={targetView.selectedProject}
        runTarget={targetView.selectedRunTarget}
        projectBadgeColor={projectBadgeColor}
        isFolderTarget={selectedProjectGroup !== null}
        canPickRunTarget={!selectedProjectGroup && targetView.selectedProject !== null}
        selectedRepoIsGit={selectedRepoIsGit}
        selectedRepoConnectionId={selectedRepoConnectionId}
        selectedRepoName={selectedTargetName}
        sshGate={executionTarget.sshGate}
        composer={composer}
        selectedAgent={agentSelection.selectedAgent}
        showAdvanced={showOptions}
        note={note}
        setupCommand={setupScript.setupCommand}
        setupSource={setupScript.setupSource}
        setupRunPolicy={setupScript.setupRunPolicy}
        setupDecisionChoice={setupScript.setupDecisionChoice}
        runSetup={setupScript.runSetup}
        waitForSetup={setupScript.waitForSetup}
        error={error}
        creating={createSubmit.creating}
        canCreate={canCreate}
        onClose={onClose}
        onOpenExternalUrl={openExternalUrl}
        onOpenProject={() => openPicker('project')}
        onOpenRunTarget={() => openPicker('runTarget')}
        onOpenSource={navigation.openSourceDrawer}
        onClearError={() => setError('')}
        onConnect={() => void executionTarget.connect()}
        onOpenAgent={() => openPicker('agent')}
        onShowAdvancedChange={(show) => {
          if (!show) {
            setNoteOptions('folded')
          }
          setupScript.setShowAdvanced(show)
        }}
        onNoteChange={setNote}
        onSetupDecisionChange={setupScript.setSetupDecisionChoice}
        onRunSetupChange={setupScript.setRunSetup}
        onWaitForSetupChange={setupScript.setWaitForSetup}
        onCreate={() => void createSubmit.create()}
      />

      <NewWorktreeModalDrawers
        visible={visible}
        drawerView={navigation.drawerView}
        client={client}
        composer={composer}
        sourceAvailability={sourceAvailability}
        selectedRepo={selectedRepo}
        repos={targetView.hostRepos}
        pasteRepos={targetView.pasteRepos}
        jiraSiteId={runtime.jiraConnection.selection}
        jiraSites={runtime.jiraConnection.sites}
        sshReady={!executionTarget.sshGate.requiresConnection}
        projectPickerItems={targetView.projectPickerItems}
        selectedProjectId={targetView.selectedProjectId}
        runTargetPickerItems={targetView.runTargetPickerItems}
        pickerAgentOptions={agentSelection.pickerAgentOptions}
        selectedAgent={agentSelection.selectedAgent}
        setupTrustPrompt={createSubmit.setupTrustPrompt}
        creating={createSubmit.creating}
        onSourceRepoChange={(repo) => selectRepo(repo, false)}
        onRepoChange={(repo) => selectRepo(repo, true)}
        onProjectGroupChange={selectProjectGroup}
        onAgentChange={(agent) => {
          agentSelection.setAgentOverridden(true)
          agentSelection.setSelectedAgent(agent)
        }}
        onTransitionToForm={() => navigation.transitionDrawer('form')}
        onApproveSetupTrust={(alwaysTrust) => void createSubmit.approveSetupTrust(alwaysTrust)}
        onSkipSetupTrust={createSubmit.skipSetupTrust}
        onCloseSetupTrust={createSubmit.closeSetupTrust}
      />
    </BottomDrawerModalHost>
  )
}
