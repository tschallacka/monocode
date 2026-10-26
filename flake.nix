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
        inherit (pkgs) lib stdenv;
        isLinux = stdenv.hostPlatform.isLinux;
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
        # Nix's GL looks for drivers under /run/opengl-driver, which only NixOS
        # has. Without one WebKit paints the page white, so point it at Mesa
        # (llvmpipe when the GPU has no Mesa driver, as with NVIDIA's).
        glDrivers = {
          __EGL_VENDOR_LIBRARY_FILENAMES = "${pkgs.mesa}/share/glvnd/egl_vendor.d/50_mesa.json";
          LIBGL_DRIVERS_PATH = "${pkgs.mesa}/lib/dri";
          GBM_BACKENDS_PATH = "${pkgs.mesa}/lib/gbm";
        };
      in
      {
        devShells.default = pkgs.mkShell (
          {
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
              ++ lib.optionals isLinux (linuxLibs ++ [ pkgs.mesa ]);

            # The tray icon loads libayatana-appindicator at runtime.
            LD_LIBRARY_PATH = lib.optionalString isLinux (lib.makeLibraryPath linuxLibs);
            RUST_SRC_PATH = "${pkgs.rustPlatform.rustLibSrc}";
          }
          // lib.optionalAttrs isLinux glDrivers
        );
      }
    );
}
