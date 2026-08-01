import { render } from '@opentui/solid'

import { App } from './app/App'
import { releaseAssetRoot } from './core/assets'
import type { Target } from './core/cli'
import { loadConfig, loadProjectConfig, readDisabledPlugins, resolveConfig } from './core/config'
import { highlightClient } from './languages/highlight'
import { loadPlugins } from './plugins'
import { setTheme } from './themes'

/** Everything past argument handling — imported dynamically by index.tsx so the
 * asset-root staging there runs before `@opentui/core` evaluates. */
export async function main(target: Target): Promise<void> {
  // The staged asset root exists only so @opentui/core's import (above) finds the
  // native library at a stable path; the next asset lookup after this point must
  // fall back to the bundled files instead.
  releaseAssetRoot()

  const { rootDir, openFile } = target

  // Before the config, not after: a plugin's theme and icon theme are only
  // valid values of those settings once the plugin has registered them, and the
  // validators drop what they do not recognise.
  loadPlugins(rootDir, readDisabledPlugins(rootDir))

  // Apply the saved theme before the first render — the project's, where it has
  // one, or the first frame paints in the user's and then repaints.
  const config = loadConfig()
  const project = loadProjectConfig(rootDir)
  setTheme(resolveConfig(config, project).theme)

  // Start the tree-sitter worker now, in parallel with the renderer's own boot:
  // spawning it plus compiling the runtime wasm is the long pole of the first
  // highlight, and nothing about it needs the UI.
  void highlightClient()

  await render(
    () => (
      <App
        rootDir={rootDir}
        openFile={openFile}
        openLine={target.line}
        openCol={target.col}
        initialConfig={config}
        initialProject={project}
      />
    ),
    {
      useMouse: true,
      // Without motion reporting the terminal never hands drags to the app, so every
      // click-drag paints the terminal's own selection over the UI instead.
      enableMouseMovement: true,
      // Ctrl+C is handled in App, not here: it copies when there is a selection and
      // quits otherwise. OpenTUI's own exit would bypass the unsaved-buffer prompt and
      // drop the work.
      exitOnCtrlC: false,
      targetFps: 30,
    },
  )
}
