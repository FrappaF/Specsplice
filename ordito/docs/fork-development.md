# Developing Specsplice from source

## From a clean clone

Install Git, Python 3, a C/C++ compiler and the Node.js version specified in [`.nvmrc`](../../.nvmrc), including its npm. Setup downloads npm dependencies, Node.js headers, Electron and the built-in extensions.

- On **macOS**, install the Command Line Tools with `xcode-select --install`. Check `xcode-select -p`, `xcrun --find clang` and `python3 --version`. Use an ARM64 build of Node.js on Apple Silicon.
- On **Debian and Ubuntu**, install `build-essential pkg-config libx11-dev libxkbfile-dev libkrb5-dev libsecret-1-dev libgtk-3-dev libgbm-dev libnss3 libasound2-dev xvfb xauth`. Package names can vary by distribution.
- On **Windows**, follow the [Code OSS prerequisites for Visual Studio and C++](https://github.com/microsoft/vscode/wiki/How-to-Contribute#prerequisites). Specsplice's desktop CI covers Linux and macOS.

On macOS and Linux, run these commands from the root of your clone with `nvm` installed.

```sh
nvm install
nvm use
npm run ordito:setup
./ordito/scripts/dev.sh
```

If you use another Node.js version manager, select the same version. `ordito:setup` prepares the headers, installs dependencies from the lockfiles, builds the client, Specsplice engine and extensions, and prepares Electron. Run `npm run ordito:setup -- --install-only` to install dependencies only, or `npm run ordito:setup -- --help` to list the options.

On macOS and Linux, `./ordito/scripts/dev.sh /path/to/project` opens a specific folder and uses a development profile under `.build/`. On Windows, run `scripts\code.bat --user-data-dir .build\ordito-profile --extensions-dir .build\ordito-extensions` after setup. The first launch may require internet access to download built-in extensions.

After updating your clone, close Specsplice and run `npm run ordito:setup` again. During development, use `npm run build-fast -- --client-only` to rebuild the client with up-to-date dependencies.

## Verify a change

```sh
npm run ordito:test
npm run ordito:check
npm run ordito:smoke:check
```

`ordito:test` runs the domain tests. `ordito:check` checks TypeScript types and `ordito:smoke:check` type-checks the desktop smoke tests. To try the built app, run `node ordito/scripts/smoke-desktop.mjs --native-only`. Prefix the command with `xvfb-run -a` on Linux without a display.

The tools in `ordito/runtime`, `ordito/code-import`, `ordito/ai` and `ordito/messaging` have their own lockfiles and tests. Use the [architecture overview](architecture.md) to find the package to check. GitHub Actions runs checks and desktop smoke tests on Linux. To run the macOS smoke tests, start the **Specsplice desktop** workflow manually.

## Package a desktop preview

Use the pinned Node.js version and the native build tools above. The Code OSS packaging task builds a standalone app for the host architecture in a sibling directory.

```sh
npm run ordito:setup -- --install-only
target=$(node -p 'process.platform + "-" + process.arch')
ORDITO_RELEASE_WITHOUT_COPILOT=1 npm run gulp -- "vscode-$target-min"
```

The desktop release profile omits the built-in GitHub Copilot extension and SDK. For Specsplice's AI workflows, install and authenticate the official CLI for your provider, then choose **AI Settings → Connect Claude Code or Codex**. [Codex CLI](https://developers.openai.com/codex/cli) · [Claude Code](https://code.claude.com/docs/en/quickstart)

The **Specsplice release** workflow builds and tests the extracted archives on macOS ARM64, macOS x86-64, and Ubuntu x86-64. Run it manually to get CI artifacts. Pushing a version tag from `main` publishes the three verified archives and `SHA256SUMS` as a GitHub prerelease. New previews use `Specsplice.app` on macOS and `Specsplice/specsplice` on Linux. The `v0.1.0` preview retains the app and archive names from its original release as Ordito. The app's compatibility version follows the Code OSS base. [Release workflow](../../.github/workflows/release.yml)

## Update the Code OSS base

The upstream revision is recorded in [`ordito/upstream.json`](../upstream.json). To try an update in a dedicated worktree, run `node ordito/scripts/prepare-upstream.mjs FULL_SHA /absolute/path/to/new-worktree`. The script applies the diff between revisions and stops if it touches Microsoft workflows. The upstream workflows are stored as `.disabled` files in `ordito/upstream-workflows/`. Before integrating the update, check the Specsplice contribution registration, the product settings and the checks affected by the diff.
