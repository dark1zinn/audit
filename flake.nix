{
  description = "A Nix-flake-based Bun development environment";

  inputs.nixpkgs.url = "https://flakehub.com/f/NixOS/nixpkgs/0.1"; # unstable Nixpkgs

  outputs =
    { self, ... }@inputs:

    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      forEachSupportedSystem =
        f:
        inputs.nixpkgs.lib.genAttrs supportedSystems (
          system:
          f {
            inherit system;
            pkgs = import inputs.nixpkgs { inherit system; };
          }
        );
    in
    {
      devShells = forEachSupportedSystem (
        { pkgs, system }:
        {
          default = pkgs.mkShellNoCC {
            packages = with pkgs; [
              bun
              playwright-driver.browsers
              # pg_dump/psql for `audit backup`/`restore`, the restore drill and the upgrade test.
              postgresql_18
              self.formatter.${system}
            ];

            # Playwright's bundled Chromium cannot start on NixOS; use the Nix-built one for e2e.
            PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
            shellHook = ''
              export PW_CHROMIUM="$(echo ${pkgs.playwright-driver.browsers}/chromium-*/chrome-linux64/chrome)"
            '';
          };
        }
      );

      formatter = forEachSupportedSystem ({ pkgs, ... }: pkgs.nixfmt-tree);
    };
}
