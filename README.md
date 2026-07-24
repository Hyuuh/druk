# druk

Terminal code editor — file tree, tabs, syntax highlighting, autocompletion. Keyboard and mouse.

Needs [Bun](https://bun.com) on your `PATH` (OpenTUI's core runs on Bun's FFI).

## Run

```bash
npm install -g druk
```

```bash
druk            # open current directory
druk ./path     # open a directory
```

`npx druk` and `bunx druk` work too.

## Develop

```bash
pnpm install
pnpm start      # run from source
pnpm build      # bundle CLI to dist/
```

## Shortcuts

`Ctrl+P` opens the command palette — every action, including the shortcuts list and theme switch. `Ctrl+S` save · `Ctrl+N` new file · `Ctrl+W` close tab · `Ctrl+Q` quit · `Tab` switch tree/editor · arrows + `Enter` navigate. Type to autocomplete (`Tab`/`Enter` accept). Themes: GitHub Dark / Light.
