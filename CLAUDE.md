@AGENTS.md

## Building the Linux app

Linux builds happen on `local/monocode-linux-install`, the base for all Linux work in this fork. It is `local/monocode-install` plus the Linux-only changes (the Nix GL driver setup and `scripts/install-linux-nix.sh`). Never build Linux from `main` or `local/monocode-install` directly. To pick up new work, merge `local/monocode-install` into `local/monocode-linux-install` first.

Build and install with `npm run install:linux-nix`, never with a bare `tauri build`. It builds inside the flake's dev shell, keeps that shell as a GC root at `~/.local/state/nix/profiles/monocode-dev` (the binary links against its Nix libraries, so never delete it), and installs the launcher at `~/.local/bin/monocode` plus a menu entry. Launch the app through that launcher or the menu, never `target/release/monocode` directly: without the launcher's Mesa and GSettings variables, WebKit paints the window white. After installing, tell the user to quit the running MonoCode and start it again from the menu.

Changes that are Linux-only go on `local/monocode-linux-install`. Changes that apply on every platform go on `local/monocode-install`, then get merged into the Linux branch.

## Building the macOS app

Whenever the app is built, and after every fork sync or merge from upstream, build it with `npm run install:macos`, never with a bare `tauri build`. It builds the bundle, copies it to `/Applications/MonoCode.app`, and unregisters every other copy (`target/` outputs, worktrees, mounted DMGs) from LaunchServices. If a bundle was already built another way, finish with `npm run install:macos -- --skip-build`.

`/Applications/MonoCode.app` must stay the only registered copy: macOS routes notification clicks by bundle identifier, so a second registered copy gets launched as a duplicate MonoCode in the Dock. Never launch the app from `target/release/bundle/`. After installing, tell the user to quit the running MonoCode and reopen it from the Dock so the new build is the one running.
