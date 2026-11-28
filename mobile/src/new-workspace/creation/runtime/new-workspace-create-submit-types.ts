import type { Dispatch, SetStateAction } from 'react'
import type { ExecutionHostId } from '../../../../../src/shared/execution-host/execution-host'
import type { ProjectGroup } from '../../../../../src/shared/project/groups/project-group-types'
import type { PersistedTrustedOrcaHooks } from '../../../../../src/shared/workspace-setup/orca-yaml-hook-types'
import type { SetupDecision as WorkspaceCreateSetupDecision } from '../../../../../src/shared/worktree/create-types'
import type { RetiredNameRegistry } from '../../../../../src/shared/worktree/naming/retired-name-registry'
import type { AgentLaunchSupport } from '../../../session/agent-launch/agent-launch-request'
import type { RpcClient } from '../../../transport/rpc/rpc-client-contract'
import type { useMobileComposerSource } from '../../source-selection/use-mobile-composer-source'
import type {
  MobileWorkspaceRepo,
  NewWorktreeFolderSubmit,
  SetupRunPolicy
} from '../forms/new-worktree-modal-types'
import type { NewWorktreeDrawerView } from '../modal/use-new-worktree-drawer-navigation'
import type { WorkspaceSshGate } from '../workspace-ssh-gate'
import type { WorktreeCreateIdempotencySupport } from '../worktree-create-idempotency-policy'
import type { WorktreeCreateParent } from '../worktree-create-retry'
import type {
  NewWorktreeAgentOption,
  NewWorktreeRuntimeSettings
} from './new-worktree-agent-selection'
import type { SheetSetupTrustPrompt } from './use-new-workspace-setup-trust'

export type UseNewWorkspaceCreateSubmitArgs = {
  client: RpcClient | null
  repos: readonly MobileWorkspaceRepo[]
  selectedRepo: MobileWorkspaceRepo | null
  selectedProjectGroup?: ProjectGroup | null
  selectedAgent: NewWorktreeAgentOption
  setSelectedAgent: (agent: NewWorktreeAgentOption) => void
  setAgentOverridden: (overridden: boolean) => void
  runtimeSettings: NewWorktreeRuntimeSettings | null
  setRuntimeSettings: (settings: NewWorktreeRuntimeSettings) => void
  detectedAgentIds: Set<string> | null
  sshGate: WorkspaceSshGate
  composer: ReturnType<typeof useMobileComposerSource>
  note: string
  existingWorktreePaths?: readonly string[]
  retiredWorktreeNames: RetiredNameRegistry
  setupCommand: string | null
  setupRunPolicy: SetupRunPolicy
  setupDecisionChoice: Exclude<WorkspaceCreateSetupDecision, 'inherit'> | null
  runSetup: boolean
  setupWait: boolean | null
  trustedOrcaHooks: PersistedTrustedOrcaHooks
  setTrustedOrcaHooks: (trust: PersistedTrustedOrcaHooks) => void
  getWorktreeCreateCutoverSupport: () => Promise<WorktreeCreateIdempotencySupport | false>
  getAgentLaunchSupport: () => Promise<AgentLaunchSupport | false>
  getBranchIntentSupport: (intent: 'open-existing-v2' | 'create-new') => Promise<boolean>
  transitionDrawer: (view: Exclude<NewWorktreeDrawerView, 'transition'>) => void
  setError: Dispatch<SetStateAction<string>>
  onCreated: (worktreeId: string, name: string, warning?: string) => void
  onClose: () => void
  /** Opened from a folder: creates on that folder's host, attached to it, owned by the folder screen. */
  folderLaunch?: NewWorktreeFolderSubmit & {
    executionHostId: ExecutionHostId
    parent: WorktreeCreateParent
  }
}

export type UseNewWorkspaceCreateSubmitResult = {
  creating: boolean
  setupTrustPrompt: SheetSetupTrustPrompt | null
  create: () => Promise<void>
  approveSetupTrust: (alwaysTrust: boolean) => Promise<void>
  closeSetupTrust: () => void
  skipSetupTrust: () => void
}
