import { useEffect, useMemo, useState } from 'react'
import {
  getRepoExecutionHostId,
  type ExecutionHostId
} from '../../../../../src/shared/execution-host/execution-host'
import type { ProjectGroup } from '../../../../../src/shared/project/groups/project-group-types'
import { MOBILE_FOLDER_WORKSPACE_CREATE_RUNTIME_CAPABILITY } from '../../../../../src/shared/remote-runtime/protocol/mobile-runtime-capabilities'
import type { RpcClient } from '../../../transport/rpc/rpc-client-contract'
import { hostProjectGroupsRead } from '../../../worktree/project-sections/project-sections-operations'
import { worktreeCreateCapabilityRead } from '../mobile-workspace-create-operations'

const NO_SERVER_CLIENTS: ReadonlyMap<ExecutionHostId, RpcClient> = new Map()
const NO_CAPABILITIES: readonly string[] = []

function isFolderBackedGroup(group: ProjectGroup): boolean {
  return Boolean(group.parentPath?.trim())
}

async function listDesktopFolderGroups(client: RpcClient): Promise<ProjectGroup[] | null> {
  const reply = await hostProjectGroupsRead.request(client)
  const listed = hostProjectGroupsRead.interpret(reply)
  return listed.accepted ? listed.value.filter(isFolderBackedGroup) : null
}

// Exclude server SSH groups: servers cannot serve them and mobile’s SSH gate reads only desktop connections.
async function listServerFolderGroups(
  executionHostId: ExecutionHostId,
  client: RpcClient
): Promise<ProjectGroup[] | null> {
  const statusReply = await worktreeCreateCapabilityRead.request(client).catch(() => null)
  const status = statusReply ? worktreeCreateCapabilityRead.interpret(statusReply) : null
  if (
    !status?.accepted ||
    !status.value.capabilities?.includes(MOBILE_FOLDER_WORKSPACE_CREATE_RUNTIME_CAPABILITY)
  ) {
    return null
  }
  const reply = await hostProjectGroupsRead.request(client).catch(() => null)
  const listed = reply ? hostProjectGroupsRead.interpret(reply) : null
  if (!listed?.accepted) {
    return null
  }
  return listed.value
    .filter((group) => !group.connectionId && isFolderBackedGroup(group))
    .map((group) => ({ ...group, executionHostId }))
}

export function isSameMobileProjectGroup(
  a: Pick<ProjectGroup, 'id' | 'connectionId' | 'executionHostId'>,
  b: Pick<ProjectGroup, 'id' | 'connectionId' | 'executionHostId'>
): boolean {
  return a.id === b.id && getRepoExecutionHostId(a) === getRepoExecutionHostId(b)
}

/** Lists folder-backed project groups on hosts that allow mobile folder-workspace creation. */
export function useNewWorkspaceProjectGroups(args: {
  client: RpcClient | null
  serverClients?: ReadonlyMap<ExecutionHostId, RpcClient>
  desktopCapabilities?: readonly string[]
  visible: boolean
  disabled?: boolean
  /** Auto-select the first folder group when no git/folder repos exist on the host. */
  autoSelectFirst?: boolean
}): {
  projectGroups: ProjectGroup[]
  selectedProjectGroup: ProjectGroup | null
  setSelectedProjectGroup: (group: ProjectGroup | null) => void
  loading: boolean
} {
  const {
    client,
    serverClients = NO_SERVER_CLIENTS,
    desktopCapabilities = NO_CAPABILITIES,
    visible,
    disabled = false,
    autoSelectFirst = false
  } = args
  const desktopSupported = desktopCapabilities.includes(
    MOBILE_FOLDER_WORKSPACE_CREATE_RUNTIME_CAPABILITY
  )
  const [desktopGroups, setDesktopGroups] = useState<ProjectGroup[]>([])
  const [desktopLoading, setDesktopLoading] = useState(false)
  const [serverGroups, setServerGroups] = useState<ReadonlyMap<ExecutionHostId, ProjectGroup[]>>(
    () => new Map()
  )
  const [pickedGroup, setSelectedProjectGroup] = useState<ProjectGroup | null>(null)

  useEffect(() => {
    if (!visible || disabled || !client || !desktopSupported) {
      setDesktopGroups([])
      setDesktopLoading(false)
      return
    }
    let stale = false
    setDesktopLoading(true)
    void listDesktopFolderGroups(client)
      .then((listed) => {
        if (!stale && listed) {
          setDesktopGroups(listed)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!stale) {
          setDesktopLoading(false)
        }
      })
    return () => {
      stale = true
    }
  }, [client, desktopSupported, disabled, visible])

  useEffect(() => {
    setServerGroups((previous) => {
      const kept = [...previous].filter(([host]) => serverClients.has(host))
      return kept.length === previous.size ? previous : new Map(kept)
    })
    if (!visible || disabled) {
      return
    }
    let stale = false
    for (const [executionHostId, serverClient] of serverClients) {
      void listServerFolderGroups(executionHostId, serverClient).then((listed) => {
        if (!stale && listed) {
          setServerGroups((previous) =>
            JSON.stringify(previous.get(executionHostId)) === JSON.stringify(listed)
              ? previous
              : new Map(previous).set(executionHostId, listed)
          )
        }
      })
    }
    return () => {
      stale = true
    }
  }, [disabled, serverClients, visible])

  const projectGroups = useMemo(
    () =>
      disabled
        ? []
        : serverGroups.size === 0
          ? desktopGroups
          : [...desktopGroups, ...[...serverGroups.values()].flat()],
    [desktopGroups, disabled, serverGroups]
  )
  const selectedProjectGroup = useMemo(
    () =>
      pickedGroup
        ? (projectGroups.find((group) => isSameMobileProjectGroup(group, pickedGroup)) ?? null)
        : null,
    [pickedGroup, projectGroups]
  )

  useEffect(() => {
    if (visible && !disabled && autoSelectFirst && !selectedProjectGroup && projectGroups[0]) {
      setSelectedProjectGroup(projectGroups[0])
    }
  }, [autoSelectFirst, disabled, projectGroups, selectedProjectGroup, visible])

  return {
    projectGroups,
    selectedProjectGroup,
    setSelectedProjectGroup,
    loading: desktopLoading && projectGroups.length === 0
  }
}
