{
  description = "MonoCode development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        # What scripts/install-linux-deps-debian.sh installs for CI.
        linuxLibs = with pkgs; [
          gtk3
          webkitgtk_4_1
          libsoup_3
          glib
          openssl
          librsvg
          libayatana-appindicator
          xdotool
        ];
      in
      {
        devShells.default = pkgs.mkShell {
          packages =
            with pkgs;
            [
              nodejs_24
              cargo
              rustc
              clippy
              rustfmt
              pkg-config
            ]
            ++ lib.optionals stdenv.hostPlatform.isLinux linuxLibs;

          # The tray icon loads libayatana-appindicator at runtime.
          LD_LIBRARY_PATH = pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux (
            pkgs.lib.makeLibraryPath linuxLibs
          );
          RUST_SRC_PATH = "${pkgs.rustPlatform.rustLibSrc}";
        };
      }
    );
}
