import type { Repo } from '../../../../../src/shared/repository/repo-types'
import type { ProjectGroup } from '../../../../../src/shared/project/groups/project-group-types'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../../../src/shared/execution-host/execution-host'
import {
  getProjectIdentityKey,
  getProjectProviderIdentity
} from '../../../../../src/shared/project/host-setup/project-host-setup-projection'
import { getHostContextLabel } from '../../../../../src/shared/worktree/row-display/host-context-labels'
import { deriveRepoSlug, type PasteRepoCandidate } from '../smart-source-paste-intent'

type WorkspaceRepo = Pick<Repo, 'id' | 'displayName' | 'path'> &
  Partial<
    Pick<Repo, 'connectionId' | 'executionHostId' | 'upstream' | 'repoIcon' | 'gitRemoteIdentity'>
  >

export type NewWorkspaceProjectOption<TRepo extends WorkspaceRepo> = {
  id: string
  label: string
  detail?: string
  repo: TRepo
}

export type NewWorkspaceTargetOption<TRepo extends WorkspaceRepo> =
  | ({ kind: 'project' } & NewWorkspaceProjectOption<TRepo>)
  | {
      kind: 'project-group'
      id: string
      label: string
      detail: string
      group: ProjectGroup
    }

export type NewWorkspaceRunTargetOption<TRepo extends WorkspaceRepo> = {
  id: string
  hostId: ExecutionHostId
  label: string
  detail: string
  repo: TRepo
}

export function projectGroupTargetId(
  group: Pick<ProjectGroup, 'id' | 'connectionId' | 'executionHostId'>
): string {
  return `project-group:${getRepoExecutionHostId(group)}:${group.id}`
}

export function buildNewWorkspaceProjectOptions<TRepo extends WorkspaceRepo>(
  repos: readonly TRepo[]
): NewWorkspaceProjectOption<TRepo>[] {
  const options = new Map<string, NewWorkspaceProjectOption<TRepo>>()
  const hostIdsByProject = new Map<string, Set<string>>()
  for (const repo of repos) {
    const id = getProjectIdentityKey(repo)
    const hostIds = hostIdsByProject.get(id) ?? new Set<string>()
    hostIds.add(getRepoExecutionHostId(repo))
    hostIdsByProject.set(id, hostIds)
    if (!options.has(id)) {
      options.set(id, {
        id,
        label: repo.displayName,
        repo
      })
    }
  }
  return [...options.values()].map((option) => {
    const providerIdentity = getProjectProviderIdentity(option.repo)
    const providerDetail = providerIdentity
      ? `${providerIdentity.owner}/${providerIdentity.repo}`
      : ''
    const hostCount = hostIdsByProject.get(option.id)?.size ?? 0
    const detail = providerDetail || (hostCount > 1 ? `${hostCount} hosts configured` : '')
    return detail ? { ...option, detail } : option
  })
}

export function buildNewWorkspaceTargetOptions<TRepo extends WorkspaceRepo>(
  repos: readonly TRepo[],
  projectGroups: readonly ProjectGroup[],
  localPlatform: NodeJS.Platform | null = null,
  hostLabelById?: ReadonlyMap<ExecutionHostId, string>
): NewWorkspaceTargetOption<TRepo>[] {
  const projectOptions: NewWorkspaceTargetOption<TRepo>[] = buildNewWorkspaceProjectOptions(
    repos
  ).map((option) => ({ kind: 'project' as const, ...option }))
  const folderOptions: NewWorkspaceTargetOption<TRepo>[] = projectGroups
    .filter((group) => Boolean(group.parentPath?.trim()))
    .map((group) => {
      const parentPath = group.parentPath?.trim() ?? ''
      const hostId = getRepoExecutionHostId(group)
      const detail =
        hostId === LOCAL_EXECUTION_HOST_ID
          ? parentPath
          : `${getHostContextLabel(hostId, { hostLabelById, hostPlatform: localPlatform })} · ${parentPath}`
      return {
        kind: 'project-group' as const,
        id: projectGroupTargetId(group),
        label: group.name,
        detail,
        group
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label) || a.detail.localeCompare(b.detail))
  return [...projectOptions, ...folderOptions]
}

export function getNewWorkspaceGroupRunTarget(
  group: Pick<ProjectGroup, 'parentPath' | 'connectionId' | 'executionHostId'>,
  localPlatform: NodeJS.Platform | null = null,
  hostLabelById?: ReadonlyMap<ExecutionHostId, string>
): {
  hostId: ExecutionHostId
  label: string
  detail: string
} {
  const hostId = getRepoExecutionHostId(group)
  return {
    hostId,
    label: getHostContextLabel(hostId, {
      hostLabelById,
      hostPlatform: localPlatform
    }),
    detail: group.parentPath?.trim() ?? ''
  }
}

/** Named like the host list's badge; the desktop's picker shows the bare host label too. */
export function getNewWorkspaceRunTarget(
  repo: WorkspaceRepo,
  localPlatform: NodeJS.Platform | null = null,
  hostLabelById?: ReadonlyMap<ExecutionHostId, string>
): {
  hostId: ExecutionHostId
  label: string
  detail: string
} {
  const hostId = getRepoExecutionHostId(repo)
  return {
    hostId,
    label: getHostContextLabel(hostId, {
      hostLabelById,
      hostPlatform: localPlatform
    }),
    detail: repo.path
  }
}

export function buildNewWorkspaceRunTargetOptions<TRepo extends WorkspaceRepo>(
  repos: readonly TRepo[],
  projectId: string | null,
  localPlatform: NodeJS.Platform | null = null,
  hostLabelById?: ReadonlyMap<ExecutionHostId, string>
): NewWorkspaceRunTargetOption<TRepo>[] {
  if (!projectId) {
    return []
  }
  const options = new Map<string, NewWorkspaceRunTargetOption<TRepo>>()
  for (const repo of repos) {
    if (getProjectIdentityKey(repo) !== projectId) {
      continue
    }
    const hostId = getRepoExecutionHostId(repo)
    if (!options.has(hostId)) {
      // Keyed by host: a repo id names one repo per host, so two hosts can share one.
      options.set(hostId, {
        id: hostId,
        ...getNewWorkspaceRunTarget(repo, localPlatform, hostLabelById),
        repo
      })
    }
  }
  return [...options.values()]
}

/** The server a repo or folder group runs on; undefined for the desktop's own (local, SSH, folder). */
export function serverOfWorkspaceTarget(target: {
  connectionId?: string | null
  executionHostId?: string | null
}): `runtime:${string}` | undefined {
  const host = parseExecutionHostId(getRepoExecutionHostId(target))
  return host?.kind === 'runtime' ? host.id : undefined
}

export function resolveNewWorkspaceTargetView<TRepo extends WorkspaceRepo>(args: {
  repos: readonly TRepo[]
  projectGroups: readonly ProjectGroup[]
  selectedRepo: TRepo | null
  selectedProjectGroup: ProjectGroup | null
  repoServer: `runtime:${string}` | undefined
  hostPlatform: NodeJS.Platform | null
  hostLabelById?: ReadonlyMap<ExecutionHostId, string>
}) {
  const {
    repos,
    projectGroups,
    selectedRepo,
    selectedProjectGroup,
    repoServer,
    hostPlatform,
    hostLabelById
  } = args
  // Why one client's: a source's repo switch is looked up through the picked target's client.
  const hostRepos = repos.filter((repo) => serverOfWorkspaceTarget(repo) === repoServer)
  const pasteRepos: PasteRepoCandidate[] = hostRepos.map((repo) => ({
    id: repo.id,
    displayName: repo.displayName,
    slug: deriveRepoSlug(repo)
  }))
  const projectPickerItems = buildNewWorkspaceTargetOptions(
    repos,
    projectGroups,
    hostPlatform,
    hostLabelById
  )
  const selectedProjectId = selectedProjectGroup
    ? projectGroupTargetId(selectedProjectGroup)
    : selectedRepo
      ? getProjectIdentityKey(selectedRepo)
      : null
  const selectedProject =
    projectPickerItems.find((project) => project.id === selectedProjectId) ?? null
  const runTargetPickerItems = selectedProjectGroup
    ? []
    : buildNewWorkspaceRunTargetOptions(repos, selectedProjectId, hostPlatform, hostLabelById)
  const selectedRunTarget = selectedProjectGroup
    ? getNewWorkspaceGroupRunTarget(selectedProjectGroup, hostPlatform, hostLabelById)
    : selectedRepo
      ? getNewWorkspaceRunTarget(selectedRepo, hostPlatform, hostLabelById)
      : null
  return {
    hostRepos,
    pasteRepos,
    projectPickerItems,
    selectedProjectId,
    selectedProject,
    runTargetPickerItems,
    selectedRunTarget
  }
}
