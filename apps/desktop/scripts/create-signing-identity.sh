#!/bin/sh
# Creates the self-signed "Kladd Self-Signed" code signing identity in the login keychain.
# Run once per Mac that builds releases: `pnpm --filter @kladd/desktop signing:setup`.
# See docs/operations/signing.md. macOS asks for your password to trust the certificate.
set -eu

NAME="Kladd Self-Signed"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-identity -v -p codesigning | grep -q "\"$NAME\""; then
  echo "\"$NAME\" already exists. Nothing to do."
  exit 0
fi

DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT
PASS=$(openssl rand -hex 16)

# /usr/bin/openssl is LibreSSL, whose PKCS#12 files `security import` reads.
/usr/bin/openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -subj "/CN=$NAME" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" \
  -keyout "$DIR/key.pem" -out "$DIR/cert.pem" 2>/dev/null
/usr/bin/openssl pkcs12 -export -inkey "$DIR/key.pem" -in "$DIR/cert.pem" \
  -name "$NAME" -out "$DIR/identity.p12" -passout "pass:$PASS"

security import "$DIR/identity.p12" -k "$KEYCHAIN" -P "$PASS" -T /usr/bin/codesign
security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$DIR/cert.pem"

security find-identity -v -p codesigning | grep "\"$NAME\""
echo "Created \"$NAME\". Back it up (Keychain Access → export as .p12): a new certificate resets users' permissions."
