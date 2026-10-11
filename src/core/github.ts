import { run } from './process'

export type ViewedState = 'viewed' | 'unviewed' | 'dismissed'

export interface PullRequest {
  id: string
  number: number
  url: string
  title: string
  state: string
  draft: boolean
  author: string
  base: string
  head: string
  baseOid: string
  headOid: string
  host: string
  owner: string
  name: string
}

export interface PullRequestFile {
  path: string
  additions: number
  deletions: number
  viewed: ViewedState
}

export type GhResult<T> = { ok: true; value: T } | { ok: false; detail: string }

const GH_TIMEOUT = 30_000

// GitHub caps a pull request's file list at 3000, a hundred to a page.
const MAX_FILE_PAGES = 30

const PR_FIELDS =
  'id,number,url,title,state,isDraft,author,baseRefName,headRefName,baseRefOid,headRefOid'

const FILES_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      files(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { path additions deletions viewerViewedState }
      }
    }
  }
}`

const viewedMutation = (name: string) => `mutation($id: ID!, $path: String!) {
  ${name}(input: { pullRequestId: $id, path: $path }) { clientMutationId }
}`

// Tests point this at a script; nothing else should.
const ghBin = () => process.env.DRUK_GH || 'gh'

const fail = (detail: string): GhResult<never> => ({ detail, ok: false })

export function explainGh(stderr: string): string {
  if (/no pull requests? found/iu.test(stderr)) {
    return 'No pull request for this branch'
  }
  if (/gh auth login|not logged in|authentication required/iu.test(stderr)) {
    return 'gh is not signed in — run gh auth login'
  }
  if (/could not determine current branch|not on any branch/iu.test(stderr)) {
    return 'Pull requests need a checked-out branch'
  }
  const line = stderr
    .split('\n')
    .map((text) => text.trim())
    .find((text) => text !== '')
  return line ?? 'gh failed'
}

async function gh(cwd: string, args: string[]): Promise<GhResult<string>> {
  const result = await run(ghBin(), args, {
    cwd,
    // gh asks on the terminal druk owns otherwise, and the TUI hangs behind it.
    env: {
      ...process.env,
      GH_NO_UPDATE_NOTIFIER: '1',
      GH_PROMPT_DISABLED: '1',
      NO_COLOR: '1',
    },
    timeout: GH_TIMEOUT,
  })
  if (result.error) {
    return fail(
      result.error.code === 'ENOENT'
        ? 'GitHub CLI (gh) is not installed — pull requests are read through it'
        : result.error.message
    )
  }
  if (result.timedOut) {
    return fail(`gh timed out after ${GH_TIMEOUT / 1000}s`)
  }
  if (result.status !== 0) {
    return fail(explainGh(result.stderr || result.stdout))
  }
  return { ok: true, value: result.stdout }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

export function pullRequestUrl(
  url: string
): { host: string; owner: string; name: string; number: number } | null {
  const match = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)/u.exec(url)
  if (!match) {
    return null
  }
  return {
    host: match[1]!,
    name: match[3]!,
    number: Number(match[4]),
    owner: match[2]!,
  }
}

export function parsePullRequest(text: string): PullRequest | null {
  const data = parseJson(text) as Record<string, unknown> | null
  if (!data || typeof data !== 'object') {
    return null
  }
  const where = pullRequestUrl(str(data.url))
  if (!where || !str(data.id) || !str(data.headRefOid)) {
    return null
  }
  const author = data.author as { login?: unknown } | null
  return {
    author: str(author?.login),
    base: str(data.baseRefName),
    baseOid: str(data.baseRefOid),
    draft: data.isDraft === true,
    head: str(data.headRefName),
    headOid: str(data.headRefOid),
    host: where.host,
    id: str(data.id),
    name: where.name,
    number: where.number,
    owner: where.owner,
    state: str(data.state).toLowerCase(),
    title: str(data.title),
    url: str(data.url),
  }
}

const VIEWED: Record<string, ViewedState> = {
  DISMISSED: 'dismissed',
  UNVIEWED: 'unviewed',
  VIEWED: 'viewed',
}

interface FilePage {
  files: PullRequestFile[]
  next: string | null
}

export function parseFilePage(text: string): FilePage | null {
  const data = parseJson(text) as {
    data?: {
      repository?: {
        pullRequest?: {
          files?: {
            pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
            nodes?: {
              path?: unknown
              additions?: unknown
              deletions?: unknown
              viewerViewedState?: unknown
            }[]
          } | null
        } | null
      } | null
    }
  } | null
  const files = data?.data?.repository?.pullRequest?.files
  if (!files || !Array.isArray(files.nodes)) {
    return null
  }
  return {
    files: files.nodes
      .filter((node) => typeof node.path === 'string')
      .map((node) => ({
        additions: Number(node.additions) || 0,
        deletions: Number(node.deletions) || 0,
        path: node.path as string,
        viewed: VIEWED[str(node.viewerViewedState)] ?? 'unviewed',
      })),
    next:
      files.pageInfo?.hasNextPage && files.pageInfo.endCursor
        ? files.pageInfo.endCursor
        : null,
  }
}

export async function pullRequestFiles(
  cwd: string,
  pr: Pick<PullRequest, 'host' | 'owner' | 'name' | 'number'>
): Promise<GhResult<PullRequestFile[]>> {
  const files: PullRequestFile[] = []
  let after: string | null = null
  for (let page = 0; page < MAX_FILE_PAGES; page += 1) {
    const args = [
      'api',
      'graphql',
      '--hostname',
      pr.host,
      '-f',
      `query=${FILES_QUERY}`,
      '-f',
      `owner=${pr.owner}`,
      '-f',
      `name=${pr.name}`,
      '-F',
      `number=${pr.number}`,
    ]
    if (after) {
      args.push('-f', `after=${after}`)
    }
    const answer = await gh(cwd, args)
    if (!answer.ok) {
      return answer
    }
    const parsed = parseFilePage(answer.value)
    if (!parsed) {
      return fail('GitHub returned no file list for this pull request')
    }
    files.push(...parsed.files)
    if (!parsed.next) {
      break
    }
    after = parsed.next
  }
  return { ok: true, value: files }
}

export async function currentPullRequest(
  cwd: string
): Promise<GhResult<PullRequest>> {
  const answer = await gh(cwd, ['pr', 'view', '--json', PR_FIELDS])
  if (!answer.ok) {
    return answer
  }
  const pr = parsePullRequest(answer.value)
  return pr ? { ok: true, value: pr } : fail('gh returned an unreadable answer')
}

export async function setFileViewed(
  cwd: string,
  pr: Pick<PullRequest, 'host' | 'id'>,
  path: string,
  viewed: boolean
): Promise<GhResult<null>> {
  const answer = await gh(cwd, [
    'api',
    'graphql',
    '--hostname',
    pr.host,
    '-f',
    `query=${viewedMutation(viewed ? 'markFileAsViewed' : 'unmarkFileAsViewed')}`,
    '-f',
    `id=${pr.id}`,
    '-f',
    `path=${path}`,
  ])
  return answer.ok ? { ok: true, value: null } : answer
}
