import type { TuiAgent } from '../../../../src/shared/agent-launch/catalog/tui-agent'
import { isAgentLaunchReplayUnsupportedRefusal } from '../../../../src/shared/agent-launch/contracts/agent-launch-replay-refusal'
import {
  EMPTY_ORCA_HOOK_CONTENT_HASH,
  hashOrcaHookContent
} from '../../../../src/shared/hashing/orca-hook-content-hash'
import type { ProjectGroup } from '../../../../src/shared/project/groups/project-group-types'
import type { RpcSendParams } from '../../../../src/shared/rpc-contract/rpc-send-params'
import { folderWorkspaceKey } from '../../../../src/shared/workspace/identity/workspace-scope'
import { getSetupTrustContent } from '../../../../src/shared/workspace-setup/hooks/orca-hook-setup-config'
import { isOrcaHookContentApproved } from '../../../../src/shared/workspace-setup/hooks/orca-hook-trust-entries'
import { projectGroupHookTrustKey } from '../../../../src/shared/workspace-setup/hooks/workspace-hook-owner'
import type { PersistedTrustedOrcaHooks } from '../../../../src/shared/workspace-setup/orca-yaml-hook-types'
import type { SetupDecision } from '../../../../src/shared/worktree/create-types'
import type { OrcaHookTrustPrompt } from '../../components/hook-trust/OrcaHookTrustDrawer'
import { translate } from '../../i18n/mobile-i18n'
import {
  agentLaunchFolderCreateParams,
  isAgentLaunchUnsupportedRefusal,
  readAgentLaunchCreateOutcome,
  type AgentLaunchSupport
} from '../../session/agent-launch/agent-launch-request'
import { structuredSessionOperationId } from '../../session/native-chat/agent-session/structured-session-operation-id'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { createdSetupReviewPrompt, readSetupTrustMismatch } from './created-worktree-setup-review'
import {
  agentLaunchReplayRun,
  agentLaunchRun,
  folderWorkspaceCreateRun
} from './mobile-workspace-create-operations'
import { sendReplayingAmbiguousDelivery } from './replay-on-ambiguous-delivery'
import { uncertainCreateMessage } from './runtime/new-workspace-create-copy'
import { projectGroupSetupHooksCheck } from './runtime/new-workspace-operations'
import type { SheetSetupTrustPrompt } from './runtime/use-new-workspace-setup-trust'
import {
  createMayRunSetup,
  wasOrcaHookPreviouslyApproved,
  type CreateSetupApproval
} from './setup-hook-trust'
import { startupAgentCreateFields } from './workspace-create-params'
import { WORKTREE_CREATE_TIMEOUT_MS } from './workspace-create-timeout'
import type { SetupRunPolicy } from './forms/new-worktree-modal-types'
import type { WorktreeCreateResult } from './worktree-create-retry'

/** Approves a folder group's shared orca.yaml setup without asking, or returns a trust prompt. */
export async function resolveFolderCreateSetupApproval(args: {
  client: RpcClient
  trust: PersistedTrustedOrcaHooks
  group: ProjectGroup
  decision: SetupDecision
}): Promise<{ approved: CreateSetupApproval } | { ask: OrcaHookTrustPrompt }> {
  const trustKey = projectGroupHookTrustKey(args.group)
  const alwaysTrusted = Boolean(args.trust[trustKey]?.all)
  // Always trust with explicit run needs no hash pin (host runs any shared setup on decision === 'run').
  if (alwaysTrusted && args.decision === 'run') {
    return { approved: {} }
  }
  const reply = projectGroupSetupHooksCheck.interpret(
    await projectGroupSetupHooksCheck.request(args.client, { groupId: args.group.id })
  )
  if (!createMayRunSetup(args.decision, reply.setupRunPolicy)) {
    return { approved: {} }
  }
  const parsedHooks = reply.hooks
    ? {
        scripts: reply.hooks.scripts ?? {},
        ...(reply.hooks.defaultTabs ? { defaultTabs: reply.hooks.defaultTabs } : {})
      }
    : null
  const scriptContent =
    reply.setupConfig && reply.setupConfig.source !== 'local'
      ? getSetupTrustContent(parsedHooks)
      : ''
  if (!scriptContent) {
    return {
      approved:
        reply.setupConfig === undefined ? {} : { approvedSetupHash: EMPTY_ORCA_HOOK_CONTENT_HASH }
    }
  }
  const contentHash = hashOrcaHookContent(scriptContent)
  if (alwaysTrusted || isOrcaHookContentApproved(args.trust, trustKey, 'setup', contentHash)) {
    return { approved: { approvedSetupHash: contentHash } }
  }
  return {
    ask: {
      kind: 'setup',
      repoId: trustKey,
      repoName: args.group.name,
      scriptContent,
      contentHash,
      previouslyApproved: wasOrcaHookPreviouslyApproved(args.trust, trustKey, 'setup'),
      versionOnly: false
    }
  }
}

export async function createFolderWorkspace(args: {
  client: RpcClient
  group: ProjectGroup
  name: string
  createdWithAgentId: TuiAgent | undefined
  setupDecision: SetupDecision
  approvedSetupHash?: string
  agentLaunchSupported: AgentLaunchSupport | false | Promise<AgentLaunchSupport | false>
}): Promise<WorktreeCreateResult> {
  const trimmedName = args.name.trim()
  const fallbackName = trimmedName || `${args.group.name} workspace`
  const baseCreate: RpcSendParams<'folderWorkspace.create'> = {
    projectGroupId: args.group.id,
    ...(trimmedName ? { name: trimmedName } : {}),
    connectionId: args.group.connectionId ?? null,
    setupDecision: args.setupDecision,
    ...(args.approvedSetupHash ? { approvedSetupHash: args.approvedSetupHash } : {})
  }
  const launch = await resolveFolderAgentLaunchRoute(
    args.createdWithAgentId,
    args.agentLaunchSupported,
    args.approvedSetupHash
  )
  const launchOperationId = launch?.replay ? structuredSessionOperationId() : null
  const directParams: RpcSendParams<'folderWorkspace.create'> = {
    ...baseCreate,
    ...startupAgentCreateFields(args.createdWithAgentId)
  }

  let usedLaunch = launch
  let sent = await sendReplayingAmbiguousDelivery(
    args.client,
    () =>
      usedLaunch
        ? launchOperationId
          ? agentLaunchReplayRun.request(
              args.client,
              {
                ...agentLaunchFolderCreateParams(usedLaunch.agent, baseCreate),
                operationId: launchOperationId
              },
              { timeoutMs: WORKTREE_CREATE_TIMEOUT_MS }
            )
          : agentLaunchRun.request(
              args.client,
              agentLaunchFolderCreateParams(usedLaunch.agent, baseCreate),
              { timeoutMs: WORKTREE_CREATE_TIMEOUT_MS }
            )
        : folderWorkspaceCreateRun.request(args.client, directParams, {
            timeoutMs: WORKTREE_CREATE_TIMEOUT_MS
          }),
    launchOperationId ? { kind: 'durable' } : null
  )

  if (
    !sent.response.ok &&
    !sent.replayed &&
    usedLaunch &&
    (launchOperationId
      ? isAgentLaunchReplayUnsupportedRefusal(sent.response.error)
      : isAgentLaunchUnsupportedRefusal(sent.response.error))
  ) {
    usedLaunch = null
    sent = await sendReplayingAmbiguousDelivery(
      args.client,
      () =>
        folderWorkspaceCreateRun.request(args.client, directParams, {
          timeoutMs: WORKTREE_CREATE_TIMEOUT_MS
        }),
      null
    )
  }

  if (!sent.response.ok) {
    return {
      error:
        sent.response.error.message ||
        translate('tasks.worktreeCreateRetry.createFailed', 'Failed to create workspace'),
      ...(sent.replayed ? { replayed: true as const } : {})
    }
  }

  if (usedLaunch) {
    const op = usedLaunch.replay ? agentLaunchReplayRun : agentLaunchRun
    const result = op.interpret(sent.response)
    const outcome = readAgentLaunchCreateOutcome(result)
    if (!outcome) {
      return {
        error: translate('tasks.worktreeCreateRetry.createFailed', 'Failed to create workspace')
      }
    }
    const setupTrustMismatch = readSetupTrustMismatch(result)
    return {
      worktreeId: outcome.worktreeId,
      name: fallbackName,
      ...(outcome.warning ? { warning: outcome.warning } : {}),
      ...(setupTrustMismatch ? { setupTrustMismatch } : {})
    }
  }

  const created = folderWorkspaceCreateRun.interpret(sent.response)
  const folderId = created.folderWorkspace.id
  if (!folderId) {
    return {
      error: translate('tasks.worktreeCreateRetry.createFailed', 'Failed to create workspace')
    }
  }
  const warning = typeof created.warning === 'string' ? created.warning.trim() : ''
  const setupTrustMismatch = readSetupTrustMismatch(created)
  return {
    worktreeId: folderWorkspaceKey(folderId),
    name: created.folderWorkspace.name?.trim() || fallbackName,
    ...(warning ? { warning } : {}),
    ...(setupTrustMismatch ? { setupTrustMismatch } : {})
  }
}

async function resolveFolderAgentLaunchRoute(
  agent: TuiAgent | undefined,
  supported: AgentLaunchSupport | false | Promise<AgentLaunchSupport | false>,
  approvedSetupHash: string | undefined
): Promise<{ agent: TuiAgent; replay: boolean } | null> {
  if (!agent) {
    return null
  }
  const support = await supported
  if (
    !support ||
    !support.createFolderWorkspace ||
    (approvedSetupHash &&
      approvedSetupHash !== EMPTY_ORCA_HOOK_CONTENT_HASH &&
      !support.reportsSetupTrustMismatch)
  ) {
    return null
  }
  return { agent, replay: support.replay }
}

export type FolderCreateSubmitOutcome =
  | { kind: 'ask-trust'; prompt: SheetSetupTrustPrompt }
  | { kind: 'error'; message: string; uncertain?: true }
  | { kind: 'created'; worktreeId: string; name: string; warning?: string }

export async function submitFolderWorkspaceCreate(args: {
  client: RpcClient
  group: ProjectGroup
  repos: readonly { id: string }[]
  name: string
  createdWithAgentId: TuiAgent | undefined
  setupDecision: SetupDecision
  setupRunPolicy: SetupRunPolicy
  setupApproval?: CreateSetupApproval
  trustedOrcaHooks: PersistedTrustedOrcaHooks
  agentLaunchSupported: AgentLaunchSupport | false | Promise<AgentLaunchSupport | false>
}): Promise<FolderCreateSubmitOutcome> {
  let setupApproval = args.setupApproval
  if (createMayRunSetup(args.setupDecision, args.setupRunPolicy) && !setupApproval) {
    const resolved = await resolveFolderCreateSetupApproval({
      client: args.client,
      trust: args.trustedOrcaHooks,
      group: args.group,
      decision: args.setupDecision
    })
    if ('ask' in resolved) {
      return { kind: 'ask-trust', prompt: resolved.ask }
    }
    setupApproval = resolved.approved
  }
  const result = await createFolderWorkspace({
    client: args.client,
    group: args.group,
    name: args.name,
    createdWithAgentId: args.createdWithAgentId,
    setupDecision: args.setupDecision,
    approvedSetupHash: setupApproval?.approvedSetupHash,
    agentLaunchSupported: args.agentLaunchSupported
  })
  if ('error' in result) {
    return result.replayed
      ? { kind: 'error', message: uncertainCreateMessage(false), uncertain: true }
      : { kind: 'error', message: result.error }
  }
  const { setupTrustMismatch: mismatch, ...created } = result
  if (mismatch) {
    return {
      kind: 'ask-trust',
      prompt: {
        ...createdSetupReviewPrompt({
          repo: { id: projectGroupHookTrustKey(args.group), displayName: args.group.name },
          repos: args.repos,
          trust: args.trustedOrcaHooks,
          mismatch
        }),
        created
      }
    }
  }
  return { kind: 'created', ...created }
}
