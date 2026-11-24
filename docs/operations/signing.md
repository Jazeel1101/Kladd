# Signing a release

Kladd is signed with a self-signed certificate, "Kladd Self-Signed", because there is no Apple Developer account. Builds are not notarized, so Gatekeeper still warns users.

macOS ties a screen recording grant to the signing certificate. With the same certificate, users keep the permission across updates. An ad-hoc signature (`-`) changes with every build, so every update would make users grant it again.

1. **Once per Mac that builds releases:** `pnpm --filter @kladd/desktop signing:setup`. It creates the certificate in the login keychain, and macOS asks for your password to trust it for code signing.
2. **Back it up:** in Keychain Access, export "Kladd Self-Signed" (certificate and private key) as a `.p12` and keep it somewhere safe. To build on another Mac, import that file and trust it for code signing instead of running step 1. A new certificate resets every user's screen recording permission, and electron-updater may refuse updates signed by it.
3. **Build:** `pnpm --filter @kladd/desktop package`. The build fails if the identity is missing (`forceCodeSigning`). To test without the certificate, add `-c.mac.identity=-` to the `electron-builder` command for an ad-hoc build.

electron-builder signs everything in the bundle, including the capture helper in `Resources/capture`. The hardened runtime is off: only notarization needs it, and without a Team ID it stops Electron loading its own frameworks.

**First launch for users:** macOS blocks an app that isn't notarized. Users open System Settings → Privacy & Security and click "Open Anyway", or run `xattr -dr com.apple.quarantine /Applications/Kladd.app`.
