#!/usr/bin/env bash
# Code Atlas: signs a built Code Atlas.app with a stable local identity.
#
# An ad-hoc signature names the app by its code hash, so macOS treats every
# build as a new app: Screen Recording and Accessibility show Code Atlas as
# allowed, yet ask again. A self-signed certificate names the app by bundle id
# and certificate instead, so one grant covers every later build, and the
# terminals, coding agents and computer-use helpers it starts inherit it.
#
# The identity lives in its own keychain under ~/.code-atlas/signing (never in
# the repository) and is created on first use without touching the login
# keychain or asking for a password. Keep that folder: a new certificate means
# granting the permissions once more.
#
#   scripts/code-atlas-sign.sh "release/mac-arm64/Code Atlas.app"
#   scripts/code-atlas-sign.sh --install "release/mac-arm64/Code Atlas.app"
set -euo pipefail

IDENTITY="Code Atlas Local Signing"
SIGNING_DIR="${CODE_ATLAS_SIGNING_DIR:-$HOME/.code-atlas/signing}"
KEYCHAIN="$SIGNING_DIR/code-atlas-signing.keychain-db"
PASSWORD_FILE="$SIGNING_DIR/keychain-password"

install=0
if [[ "${1:-}" == "--install" ]]; then
  install=1
  shift
fi
app="${1:-}"
if [[ -z "$app" || ! -d "$app" || "$app" != *.app ]]; then
  echo "usage: $0 [--install] path/to/Code Atlas.app" >&2
  exit 64
fi
app="$(cd "$(dirname "$app")" && pwd)/$(basename "$app")"

ensure_identity() {
  mkdir -p "$SIGNING_DIR"
  chmod 700 "$SIGNING_DIR"
  if [[ ! -f "$PASSWORD_FILE" ]]; then
    (umask 077 && openssl rand -hex 24 >"$PASSWORD_FILE")
  fi
  local password
  password="$(cat "$PASSWORD_FILE")"
  if [[ ! -f "$KEYCHAIN" ]]; then
    security create-keychain -p "$password" "$KEYCHAIN"
  fi
  # No auto-lock: a long build must not find the keychain locked at the end.
  security set-keychain-settings "$KEYCHAIN"
  security unlock-keychain -p "$password" "$KEYCHAIN"
  if security find-identity -p codesigning "$KEYCHAIN" | grep -q "\"$IDENTITY\""; then
    return
  fi
  echo "Creating the signing identity \"$IDENTITY\" in $KEYCHAIN"
  local work
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' RETURN
  cat >"$work/cert.cnf" <<EOF
[req]
distinguished_name = dn
prompt = no
x509_extensions = ext
[dn]
CN = $IDENTITY
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF
  openssl req -x509 -newkey rsa:2048 -nodes -days 7300 -config "$work/cert.cnf" \
    -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null
  # macOS's importer reads only the legacy PKCS#12 ciphers.
  openssl pkcs12 -export -legacy -inkey "$work/key.pem" -in "$work/cert.pem" \
    -out "$work/identity.p12" -passout pass:code-atlas 2>/dev/null ||
    openssl pkcs12 -export -inkey "$work/key.pem" -in "$work/cert.pem" \
      -out "$work/identity.p12" -passout pass:code-atlas
  security import "$work/identity.p12" -k "$KEYCHAIN" -P code-atlas -T /usr/bin/codesign >/dev/null
  # Lets codesign use the key without a keychain prompt.
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$KEYCHAIN" >/dev/null
}

sign() {
  codesign --force --sign "$IDENTITY" --keychain "$KEYCHAIN" --timestamp=none "$@" 2>&1 |
    { grep -v "replacing existing signature" || true; } >&2
}

ensure_identity

# Inside out: loose Mach-O files, then nested bundles, then the app itself.
while IFS= read -r -d '' file; do
  if file -b "$file" | grep -q "Mach-O"; then
    sign "$file" >/dev/null 2>&1 || true
  fi
done < <(find "$app/Contents/Resources" "$app/Contents/Frameworks" -type f \
  \( -perm -u+x -o -name "*.node" -o -name "*.dylib" \) -print0)
while IFS= read -r -d '' bundle; do
  sign "$bundle" >/dev/null
done < <(find "$app/Contents/Frameworks" -depth \( -name "*.framework" -o -name "*.app" \) -print0)
sign "$app" >/dev/null
codesign --verify --deep --strict "$app"
echo "Signed: $(codesign -d -r- "$app" 2>&1 | sed -n 's/^designated => //p')"

if [[ "$install" == 1 ]]; then
  target="/Applications/Code Atlas.app"
  if pgrep -xq "Code Atlas"; then
    echo "Quit Code Atlas before installing." >&2
    exit 1
  fi
  rm -rf "$target"
  ditto "$app" "$target"
  echo "Installed: $target"
fi
