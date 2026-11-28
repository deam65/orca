import { describe, expect, it, vi } from 'vitest'
import { hashOrcaHookContent } from '../../../../src/shared/hashing/orca-hook-content-hash'
import type { ProjectGroup } from '../../../../src/shared/project/groups/project-group-types'
import { projectGroupHookTrustKey } from '../../../../src/shared/workspace-setup/hooks/workspace-hook-owner'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import type { RpcResponse } from '../../transport/rpc/rpc-wire-types'
import { buildNewWorkspaceTargetOptions } from '../source-selection/presentation/new-workspace-project-targets'
import { createFolderWorkspace, resolveFolderCreateSetupApproval } from './folder-workspace-create'

const GROUP: ProjectGroup = {
  id: 'pg-work',
  name: 'Work Folder',
  parentPath: '/Users/dev/work',
  connectionId: null,
  parentGroupId: null,
  createdFrom: 'folder-scan',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1
}

function makeClient(
  handler: (method: string, params: unknown) => Promise<RpcResponse> | RpcResponse
): RpcClient {
  return {
    sendRequest: vi.fn(async (method: string, params?: unknown) => handler(method, params)),
    subscribe: () => () => {},
    updateTerminalSubscriptionViewport: () => {},
    getState: () => 'connected',
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => 1,
    onStateChange: () => () => {},
    notifyForeground: () => {},
    close: () => {}
  }
}

describe('mobile folder workspace creation', () => {
  it('merges git repos and folder-backed project groups with host-qualified group ids', () => {
    const options = buildNewWorkspaceTargetOptions(
      [{ id: 'r1', displayName: 'orca', path: '/Users/dev/work/orca' }],
      [
        GROUP,
        { ...GROUP, id: 'pg-no-path', name: 'Manual Group', parentPath: null },
        {
          ...GROUP,
          id: 'pg-work',
          name: 'Server Folder',
          parentPath: '/srv/work',
          executionHostId: 'runtime:srv-1'
        }
      ],
      'darwin',
      new Map([['runtime:srv-1', 'Dev Box']])
    )
    expect(options.map((item) => ({ kind: item.kind, id: item.id, detail: item.detail }))).toEqual([
      { kind: 'project', id: 'repo:r1', detail: undefined },
      {
        kind: 'project-group',
        id: 'project-group:runtime:srv-1:pg-work',
        detail: 'Dev Box · /srv/work'
      },
      { kind: 'project-group', id: 'project-group:local:pg-work', detail: '/Users/dev/work' }
    ])
  })

  it('requires setup trust for untrusted shared orca.yaml and pins content hash once approved', async () => {
    const script = 'pnpm install'
    const expectedHash = hashOrcaHookContent(script)
    const client = makeClient(() => ({
      id: '1',
      ok: true,
      result: {
        hooks: { scripts: { setup: script } },
        setupRunPolicy: 'run-by-default',
        setupConfig: { command: script, kind: 'setup', source: 'yaml' }
      }
    }))

    const untrusted = await resolveFolderCreateSetupApproval({
      client,
      trust: {},
      group: GROUP,
      decision: 'inherit'
    })
    expect('ask' in untrusted).toBe(true)
    if ('ask' in untrusted) {
      expect(untrusted.ask.repoId).toBe(projectGroupHookTrustKey(GROUP))
      expect(untrusted.ask.contentHash).toBe(expectedHash)
    }

    const approved = await resolveFolderCreateSetupApproval({
      client,
      trust: {
        [projectGroupHookTrustKey(GROUP)]: {
          setup: { contentHash: expectedHash, approvedAt: 1 }
        }
      },
      group: GROUP,
      decision: 'inherit'
    })
    expect(approved).toEqual({ approved: { approvedSetupHash: expectedHash } })
  })

  it('creates a blank folder workspace via folderWorkspace.create and returns folder:<id>', async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const client = makeClient((method, params) => {
      calls.push({ method, params })
      return {
        id: '1',
        ok: true,
        result: { folderWorkspace: { id: 'fw-42', name: 'Sprint' } }
      }
    })

    const result = await createFolderWorkspace({
      client,
      group: GROUP,
      name: 'Sprint',
      createdWithAgentId: undefined,
      setupDecision: 'inherit',
      agentLaunchSupported: false
    })

    expect(calls).toEqual([
      {
        method: 'folderWorkspace.create',
        params: {
          projectGroupId: 'pg-work',
          name: 'Sprint',
          connectionId: null,
          setupDecision: 'inherit'
        }
      }
    ])
    expect(result).toEqual({ worktreeId: 'folder:fw-42', name: 'Sprint' })
  })

  it('uses agent.launchReplay create-folder-workspace when supported and falls back to folderWorkspace.create on refusal', async () => {
    const methods: string[] = []
    const client = makeClient((method) => {
      methods.push(method)
      if (method === 'agent.launchReplay') {
        return {
          id: '1',
          ok: false,
          error: { code: 'method_not_found', message: 'agent_launch_replay_unsupported' }
        }
      }
      return {
        id: '2',
        ok: true,
        result: { folderWorkspace: { id: 'fw-99', name: 'Work Folder workspace' } }
      }
    })

    const result = await createFolderWorkspace({
      client,
      group: GROUP,
      name: '',
      createdWithAgentId: 'claude',
      setupDecision: 'inherit',
      agentLaunchSupported: {
        replay: true,
        reportsSetupTrustMismatch: true,
        createFolderWorkspace: true
      }
    })

    expect(methods).toEqual(['agent.launchReplay', 'folderWorkspace.create'])
    expect(result).toEqual({ worktreeId: 'folder:fw-99', name: 'Work Folder workspace' })
  })
})
