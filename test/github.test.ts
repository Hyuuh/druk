import { expect, test } from 'bun:test'

import {
  explainGh,
  parseFilePage,
  parsePullRequest,
  pullRequestUrl,
} from '../src/core/github'

test('a pull request URL names its host, repository and number', () => {
  expect(pullRequestUrl('https://github.com/acme/widgets/pull/7')).toEqual({
    host: 'github.com',
    name: 'widgets',
    number: 7,
    owner: 'acme',
  })
  expect(
    pullRequestUrl('https://git.corp.example/team/app/pull/12/files')?.host
  ).toBe('git.corp.example')
  expect(pullRequestUrl('https://github.com/acme/widgets')).toBeNull()
})

test('gh pr view is read into a pull request', () => {
  const pr = parsePullRequest(
    JSON.stringify({
      author: { login: 'octo' },
      baseRefName: 'main',
      baseRefOid: 'b'.repeat(40),
      headRefName: 'feature',
      headRefOid: 'a'.repeat(40),
      id: 'PR_1',
      isDraft: true,
      number: 7,
      state: 'OPEN',
      title: 'Add widgets',
      url: 'https://github.com/acme/widgets/pull/7',
    })
  )
  expect(pr).toMatchObject({
    author: 'octo',
    draft: true,
    host: 'github.com',
    id: 'PR_1',
    name: 'widgets',
    number: 7,
    owner: 'acme',
    state: 'open',
  })
  expect(parsePullRequest('not json')).toBeNull()
  expect(parsePullRequest('{"url":"https://github.com/a/b/pull/1"}')).toBeNull()
})

test('a page of files carries each one’s viewed state and the next cursor', () => {
  const page = parseFilePage(
    JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            files: {
              nodes: [
                {
                  additions: 2,
                  deletions: 1,
                  path: 'a.ts',
                  viewerViewedState: 'VIEWED',
                },
                {
                  additions: 0,
                  deletions: 3,
                  path: 'b.ts',
                  viewerViewedState: 'DISMISSED',
                },
                {
                  additions: 1,
                  deletions: 0,
                  path: 'c.ts',
                  viewerViewedState: 'UNVIEWED',
                },
              ],
              pageInfo: { endCursor: 'Y3Vy', hasNextPage: true },
            },
          },
        },
      },
    })
  )
  expect(page?.next).toBe('Y3Vy')
  expect(page?.files.map((file) => file.viewed)).toEqual([
    'viewed',
    'dismissed',
    'unviewed',
  ])
  expect(parseFilePage('{"data":{"repository":null}}')).toBeNull()
})

test('gh failures read as what to do about them', () => {
  expect(explainGh('no pull requests found for branch "feature"')).toBe(
    'No pull request for this branch'
  )
  expect(
    explainGh('To get started with GitHub CLI, please run:  gh auth login')
  ).toBe('gh is not signed in — run gh auth login')
  expect(explainGh('\nGraphQL: Something broke (path)\n')).toBe(
    'GraphQL: Something broke (path)'
  )
})
