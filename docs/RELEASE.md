# Release procedure

## Version and validation

`package.json` is canonical. Edit its version, run `npm run version:sync`, and commit all five metadata/lockfile changes. `npm run version:check` checks npm package/root lock, Tauri, Cargo package and Cargo lock versions. A tag must be `v<version>`. About and diagnostics use the same package version. RC is not Stable.

Run `npm ci`, `npm run check`, `npm test`, `node --test scripts/release.test.mjs`, `npm run build`, `cargo test --lib --locked --manifest-path src-tauri/Cargo.toml`, `cargo build --locked --manifest-path src-tauri/Cargo.toml`, identity/security audits and native acceptance. Use a clean clone without copied node_modules, dist or target. A dependency cache is allowed; an existing build directory is not clean-build evidence.

## CI and artifacts

CI runs quality/security plus native packages on macos-15 ARM64, macos-15-intel x64, windows-2022 x64 and ubuntu-24.04 x64. Release workflow checks the selected ref, builds the same matrix, names actual architectures, calculates SHA-256 and retains packages for 30 days. Rust paths are remapped; frontend source maps are disabled. Artifact auditing rejects developer home paths and credential-shaped strings. Review archive contents, license/notices and runtime version as well.

Tag pushes only build artifacts. `workflow_dispatch` defaults to `publish=false`, `signing=false`; deliberate `publish=true` on an existing version tag creates a **draft**, never auto-publishes. Configure approval protection on the GitHub `release` environment before using it. Untagged dispatch is a dry run and cannot create a release. No stable v1.0.0 tag or merge is authorized by the RC process. Require green checks and human review before merge/publication.

Download each native artifact from the run. Its ZIP contains the package, target-specific SHA256SUMS and metadata with exact source commit. Verify on macOS/Linux using `shasum -a 256 <file>` / `sha256sum <file>`; on Windows use `Get-FileHash <file> -Algorithm SHA256`. Compare the value, not only the filename. Checksums establish integrity, not publisher identity. CI provenance identifies the source; byte-for-byte reproducibility is not claimed.

## Optional Apple signing and notarization

The release dispatch `signing=true` uses GitHub encrypted secrets `APPLE_CERTIFICATE` (base64 Developer ID Application .p12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), `APPLE_TEAM_ID`. All are required for the configured Apple-ID notarization path. Tauri imports/signs/notarizes, then CI requires `codesign --verify --deep --strict`, `xcrun stapler validate` and `spctl --assess --type execute`. Credentials never enter the repository. See [official Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/). Unsigned RC builds remain available without secrets. No claim of notarization is made until that job passes.

## Optional Windows signing

The same dispatch uses encrypted `WINDOWS_CERTIFICATE` (base64 .pfx) and `WINDOWS_CERTIFICATE_PASSWORD`. An ephemeral runner imports the certificate into CurrentUser's certificate store and creates a temporary Tauri config with certificateThumbprint, SHA256 and DigiCert timestamp URL. CI verifies installer Authenticode status before labeling it signed. The temporary PFX is removed in a finally block; only release-artifacts is uploaded. See [official Tauri Windows signing](https://v2.tauri.app/distribute/sign/windows/). Missing required credentials fail a requested signing build. Linux artifacts retain unsigned labeling.

## Local macOS package

```sh
npm run tauri:build -- --ci --target aarch64-apple-darwin --bundles app -- --locked
npm run release:artifacts -- aarch64-apple-darwin unsigned
```

The wrapper strips build-machine path prefixes. Packaging copies bundled LICENSE and THIRD_PARTY_NOTICES. Local ad hoc signing is not Developer ID signing and does not satisfy notarization or Gatekeeper distribution acceptance. Keep production bundle identity `com.nyrc.companion`; an isolated automation copy may use a distinct LaunchServices identity only when code-payload equivalence is checked and documented.

## Known external requirements

Trusted signing/notarization needs real Apple/Windows credentials. Live cloud/Google needs accounts, keys and consent. Real ESP32 needs hardware. Windows/Linux/Intel native UX acceptance needs those environments. Repository URL contains a historical misspelling; a manual rename to `NotYourRegularCompanion-NYRC` is recommended after checking redirects/integrations. Do not rename it automatically during release.
