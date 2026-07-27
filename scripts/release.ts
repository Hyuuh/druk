import { existsSync } from 'node:fs'
import { cp, mkdir, rm } from 'node:fs/promises'

import { binaryName } from '../build'
import type { TargetName } from '../build'

/**
 * Packages the binaries built by build.ts:
 *   dist/npm/druk-<target>/     one npm package per platform, holding one executable
 *   dist/npm/druk/              the package users install, a shim plus optional deps
 *   dist/release/druk-<target>.{zip,tar.gz}   release assets the install script pulls
 *
 * The platform packages must be published *before* the root package: npm resolves
 * optional dependencies at install time, and a root package pointing at versions that
 * do not exist yet installs cleanly and then fails to run.
 *
 * Run after `bun run build <targets>`; only targets with a built binary are packaged.
 */
const NPM_DIR = './dist/npm'
const RELEASE_DIR = './dist/release'

const { version, homepage, license, author, repository } = await Bun.file('./package.json').json()

const ALL_TARGETS: TargetName[] = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'windows-x64',
]

const requested = process.argv.slice(2).filter(arg => !arg.startsWith('-'))
const publish = process.argv.includes('--publish')

const targets = (requested.length ? (requested as TargetName[]) : ALL_TARGETS).filter(target =>
  existsSync(`./dist/${target}/${binaryName(target)}`),
)

if (targets.length === 0) {
  process.stderr.write('no built binaries in dist/ — run `bun run build` first\n')
  process.exit(1)
}

await rm(NPM_DIR, { recursive: true, force: true })
await rm(RELEASE_DIR, { recursive: true, force: true })
await mkdir(RELEASE_DIR, { recursive: true })

const common = { version, license, author, homepage, repository }

for (const target of targets) {
  const [os, cpu] = target.split('-') as [string, string]
  const exe = binaryName(target)
  const dir = `${NPM_DIR}/druk-${target}`

  await mkdir(`${dir}/bin`, { recursive: true })
  await cp(`./dist/${target}/${exe}`, `${dir}/bin/${exe}`)
  await Bun.write(
    `${dir}/package.json`,
    `${JSON.stringify(
      {
        name: `druk-${target}`,
        description: `${target} binary for druk`,
        ...common,
        os: [os === 'windows' ? 'win32' : os],
        cpu: [cpu],
      },
      null,
      2,
    )}\n`,
  )

  const archive = `${RELEASE_DIR}/druk-${target}.${os === 'linux' ? 'tar.gz' : 'zip'}`
  const from = `${dir}/bin`
  if (os === 'linux') {
    await Bun.$`tar -czf ${archive} -C ${from} ${exe}`
  } else if (Bun.which('zip')) {
    await Bun.$`zip -qj ${archive} ${`${from}/${exe}`}`
  } else {
    // Windows has no `zip`, but its bsdtar picks the format from the extension.
    await Bun.$`tar -a -cf ${archive} -C ${from} ${exe}`
  }
  process.stdout.write(`packaged ${target} -> ${dir}, ${archive}\n`)
}

const rootDir = `${NPM_DIR}/druk`
await mkdir(`${rootDir}/bin`, { recursive: true })
await cp('./bin/druk.js', `${rootDir}/bin/druk.js`)
await cp('./README.md', `${rootDir}/README.md`)

const rootPkg = await Bun.file('./package.json').json()
await Bun.write(
  `${rootDir}/package.json`,
  `${JSON.stringify(
    {
      ...rootPkg,
      // The repo itself is private so a stray `npm publish` at the root cannot ship a
      // shim with no binaries behind it; the staged copy is the publishable one.
      '//private': undefined,
      'private': undefined,
      'bin': { druk: './bin/druk.js' },
      'files': ['bin'],
      // The published package builds nothing and has no sources to check.
      'scripts': undefined,
      'devDependencies': undefined,
      // Every dependency is compiled into the binaries; all that is left to fetch is
      // the one platform package for the machine doing the installing.
      'dependencies': undefined,
      // Bun is a build-time requirement now, not something the installer needs.
      'engines': undefined,
      'optionalDependencies': Object.fromEntries(
        targets.map(target => [`druk-${target}`, version]),
      ),
    },
    null,
    2,
  )}\n`,
)
process.stdout.write(`packaged druk -> ${rootDir}\n`)

if (publish) {
  if (targets.length !== ALL_TARGETS.length) {
    const missing = ALL_TARGETS.filter(t => !targets.includes(t))
    process.stderr.write(
      `refusing to publish without every platform: missing ${missing.join(', ')}\n`,
    )
    process.exit(1)
  }
  // npm refuses a prerelease without an explicit tag, and rightly so: `1.0.0-beta.1`
  // on `latest` would become what every plain `npm install -g druk` gets. The
  // identifier is the tag, so a beta lands on `beta` and is installed on purpose.
  const tag = /-([a-z][\da-z]*)/i.exec(version)?.[1] ?? 'latest'
  for (const target of targets) {
    await Bun.$`npm publish --access public --tag ${tag}`.cwd(`${NPM_DIR}/druk-${target}`)
  }
  await Bun.$`npm publish --access public --tag ${tag}`.cwd(rootDir)
}
