import { createHash } from 'node:crypto'
import { chmod, cp, mkdir, rm } from 'node:fs/promises'

/**
 * Writes the Homebrew formula for the current version to dist/release/druk.rb, with the
 * checksums of the archives `bun run release` produced, and the bottles that formula
 * pours — built here, into the same directory, from the binaries in dist/<target>/. The
 * release workflow runs this between packaging and upload, so druk.rb and its bottles
 * ship as release assets, and its `tap` job commits druk.rb to letstri/homebrew-tap as
 * Formula/druk.rb — when TAP_TOKEN is set, which is the only thing that step needs and
 * the only credential the release stores. Without the secret the formula is still on the
 * release, to be copied over by hand.
 *
 * The formula installs the prebuilt binary; brew never compiles druk, so a machine that
 * installs it this way needs neither Bun nor Node.
 *
 * The bottles are what make that true. A formula with no bottle for the running platform
 * is a *source build* as far as brew is concerned, whatever its `install` does, and
 * `FormulaInstaller#install` runs `perform_build_from_source_checks` before it looks at
 * one — which is fatal on a machine whose Xcode is older than the running macOS wants
 * (issue #40: a macOS 27 beta rejecting Xcode 26.6), and raises `UnbottledError` on a
 * machine with no developer tools at all. Pouring a bottle skips both. Bottles are also
 * the only way brew installs anything without a compiler, so this is the arrangement,
 * not a workaround.
 */
// Only the *outputs* move with DRUK_DIST, matching release.ts — the tests package into a
// temp directory through it so a run never rewrites the dist/ a developer just built.
const DIST = process.env.DRUK_DIST ?? './dist'
const RELEASE_DIR = `${DIST}/release`
const BOTTLE_STAGE = `${DIST}/bottle`

const { version, description, homepage, license } = await Bun.file('./package.json').json()

const ARCHIVES = {
  'darwin-arm64': 'druk-darwin-arm64.zip',
  'darwin-x64': 'druk-darwin-x64.zip',
  'linux-arm64': 'druk-linux-arm64.tar.gz',
  'linux-x64': 'druk-linux-x64.tar.gz',
} as const

// One bottle tag per architecture, naming the *oldest* system the binary runs on rather
// than the one it was built on: brew pours the newest bottle at or below the running
// macOS, so a single `ventura` pair covers every later release — including the ones this
// version of druk predates, which is what keeps a macOS beta from falling back to a
// source build. Linux tags carry no version and match exactly.
const BOTTLE_TAGS = {
  'darwin-arm64': 'arm64_ventura',
  'darwin-x64': 'ventura',
  'linux-arm64': 'arm64_linux',
  'linux-x64': 'x86_64_linux',
} as const

type Target = keyof typeof ARCHIVES

async function sha256(path: string): Promise<string> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    process.stderr.write(`missing archive: ${path} — run \`bun run release\` first\n`)
    process.exit(1)
  }
  return createHash('sha256')
    .update(new Uint8Array(await file.arrayBuffer()))
    .digest('hex')
}

// Homebrew derives the URL of a bottle from the formula, not the other way round: for a
// `root_url` that is not GitHub Packages it appends `<name>-<version>.<tag>.bottle.tar.gz`
// — one dash, where the file brew itself builds has two. The name has to be this.
const bottleName = (tag: string) => `druk-${version}.${tag}.bottle.tar.gz`

/** Tars the binary as a keg — `druk/<version>/bin/druk`, what brew unpacks into Cellar. */
async function bottle(target: Target, tag: string): Promise<string> {
  const binary = `${DIST}/${target}/druk`
  if (!(await Bun.file(binary).exists())) {
    process.stderr.write(`missing binary: ${binary} — run \`bun run build ${target}\` first\n`)
    process.exit(1)
  }

  const stage = `${BOTTLE_STAGE}/${tag}`
  await rm(stage, { recursive: true, force: true })
  await mkdir(`${stage}/druk/${version}/bin`, { recursive: true })
  await cp(binary, `${stage}/druk/${version}/bin/druk`)
  // The workflow downloads the binaries as artifacts, which do not carry a mode.
  await chmod(`${stage}/druk/${version}/bin/druk`, 0o755)

  const path = `${RELEASE_DIR}/${bottleName(tag)}`
  // COPYFILE_DISABLE keeps macOS tar from writing ._ AppleDouble members for extended
  // attributes; brew would pour them into the keg alongside the binary.
  await Bun.$`tar -czf ${path} -C ${stage} druk`.env({ ...process.env, COPYFILE_DISABLE: '1' })
  return path
}

const targets = Object.keys(ARCHIVES) as Target[]

const sums = Object.fromEntries(
  await Promise.all(
    targets.map(async target => [target, await sha256(`${RELEASE_DIR}/${ARCHIVES[target]}`)]),
  ),
) as Record<Target, string>

const bottles = Object.fromEntries(
  await Promise.all(
    targets.map(async target => [target, await sha256(await bottle(target, BOTTLE_TAGS[target]))]),
  ),
) as Record<Target, string>

await rm(BOTTLE_STAGE, { recursive: true, force: true })

const base = `${homepage}/releases/download/v${version}`

// `brew audit --strict` fails a desc that opens with an article, and package.json's
// opens with "A". Trimming it here keeps one description in package.json rather than a
// second one spelled out for Homebrew, which would drift.
const desc = description
  .replace(/"/g, "'")
  .split('—')[0]!
  .trim()
  .replace(/^(a|an|the) /i, '')
  .replace(/^./, (c: string) => c.toUpperCase())

// `any_skip_relocation`, not a cellar path: the binary is one self-contained executable
// with nothing linked against the Cellar, so it pours into any prefix untouched. A cellar
// that named this machine's prefix would send everyone else back to a source build.
const sha256s = targets
  .map(
    target =>
      `    sha256 cellar: :any_skip_relocation, ${BOTTLE_TAGS[target]}: "${bottles[target]}"`,
  )
  .join('\n')

// The `version` stanza has to stay, however redundant it reads next to a URL carrying
// the tag. Homebrew scans the version out of the archive's *stem*, not the tag: the
// parser for `foobar4.5.1` matches trailing digits, and druk-darwin-arm64 ends in one,
// so a formula without this reports `stable 64` — same for every release, which leaves
// `brew upgrade letstri/tap/druk` with nothing to upgrade to, and fails the test block
// below, which compares `version` against what the binary prints.
const formula = `# Generated by scripts/formula.ts — do not edit by hand.
class Druk < Formula
  desc "${desc}"
  homepage "${homepage}"
  version "${version}"
  license "${license}"

  on_macos do
    on_arm do
      url "${base}/${ARCHIVES['darwin-arm64']}"
      sha256 "${sums['darwin-arm64']}"
    end
    on_intel do
      url "${base}/${ARCHIVES['darwin-x64']}"
      sha256 "${sums['darwin-x64']}"
    end
  end

  on_linux do
    on_arm do
      url "${base}/${ARCHIVES['linux-arm64']}"
      sha256 "${sums['linux-arm64']}"
    end
    on_intel do
      url "${base}/${ARCHIVES['linux-x64']}"
      sha256 "${sums['linux-x64']}"
    end
  end

  bottle do
    root_url "${base}"
${sha256s}
  end

  def install
    bin.install "druk"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/druk --version")
  end
end
`

await Bun.write(`${RELEASE_DIR}/druk.rb`, formula)
process.stdout.write(`wrote ${RELEASE_DIR}/druk.rb\n`)
