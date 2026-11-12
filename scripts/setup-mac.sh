#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# APPCLAW — macOS bootstrap installer (idempotent v2)
#
# Installs ONLY what is missing:
#   Homebrew
#   Node.js LTS
#   OpenJDK LTS
#   Android platform-tools
#   Android SDK command-line tools (when available)
#   Appium
#   UiAutomator2 driver
#   XCUITest driver (only when Xcode exists)
#   AppClaw npm dependencies
#
# It also permanently configures ~/.zprofile so node/appium/java/adb
# remain available in every new Terminal.
#
# Usage:
#   chmod +x scripts/setup-mac.sh
#   ./scripts/setup-mac.sh
# ─────────────────────────────────────────────────────────────────────

set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

info()   { echo -e "${CYAN}▶${NC} $*"; }
ok()     { echo -e "${GREEN}✓${NC} $*"; }
warn()   { echo -e "${YELLOW}!${NC} $*"; }
fail()   { echo -e "${RED}✗${NC} $*" >&2; exit 1; }
header() {
  echo
  echo -e "${BOLD}════════════════════════════════════════════════════════════${NC}"
  echo -e "${BOLD}$*${NC}"
}
have() { command -v "$1" >/dev/null 2>&1; }

trap 'echo -e "${RED}✗ Setup failed at line $LINENO.${NC}" >&2' ERR

# ── Basic checks ──────────────────────────────────────────────────────
header "AppClaw macOS Setup"

[[ "$(uname -s)" == "Darwin" ]] || fail "This installer supports macOS only."
[[ "${EUID}" -ne 0 ]] || fail "Do not run this script with sudo."

ARCH="$(uname -m)"
case "$ARCH" in
  arm64)  ok "Apple Silicon Mac detected" ;;
  x86_64) ok "Intel Mac detected" ;;
  *) fail "Unsupported Mac architecture: $ARCH" ;;
esac

# ── Homebrew ──────────────────────────────────────────────────────────
header "1. Homebrew"

if have brew; then
  ok "Homebrew already installed — skipping"
else
  info "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

if [[ -x /opt/homebrew/bin/brew ]]; then
  BREW_PREFIX="/opt/homebrew"
elif [[ -x /usr/local/bin/brew ]]; then
  BREW_PREFIX="/usr/local"
else
  fail "Homebrew installation could not be found."
fi

eval "$("$BREW_PREFIX/bin/brew" shellenv)"

# ── Persistent zsh configuration ─────────────────────────────────────
header "2. Persistent shell environment"

ZPROFILE="$HOME/.zprofile"
touch "$ZPROFILE"

APPCLAW_START="# >>> APPCLAW AUTO ENV >>>"
APPCLAW_END="# <<< APPCLAW AUTO ENV <<<"

TMP_FILE="$(mktemp)"
awk -v start="$APPCLAW_START" -v end="$APPCLAW_END" '
  $0 == start {skip=1; next}
  $0 == end   {skip=0; next}
  !skip {print}
' "$ZPROFILE" > "$TMP_FILE"

cat >> "$TMP_FILE" <<EOF

$APPCLAW_START
# Automatically maintained by AppClaw setup.
eval "\$($BREW_PREFIX/bin/brew shellenv)"
export ANDROID_HOME="\$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="\$ANDROID_HOME"
export PATH="$BREW_PREFIX/bin:\$PATH"
export PATH="\$ANDROID_HOME/platform-tools:\$PATH"
export PATH="\$ANDROID_HOME/emulator:\$PATH"
export PATH="\$ANDROID_HOME/cmdline-tools/latest/bin:\$PATH"
# npm global executables are added below after npm is available.
$APPCLAW_END
EOF

mv "$TMP_FILE" "$ZPROFILE"
eval "$("$BREW_PREFIX/bin/brew" shellenv)"
ok "~/.zprofile configured"

# ── Node.js ───────────────────────────────────────────────────────────
header "3. Node.js LTS"

# Appium 3 supports Node ^20.19.0 || ^22.12.0 || >=24.0.0.
# Prefer Homebrew's current Node formula when no suitable Node exists.
NODE_OK=false

if have node; then
  NODE_VERSION="$(node -v | sed 's/^v//')"
  NODE_MAJOR="${NODE_VERSION%%.*}"
  NODE_MINOR="$(echo "$NODE_VERSION" | cut -d. -f2)"

  if (( NODE_MAJOR >= 24 )) ||
     (( NODE_MAJOR == 22 && NODE_MINOR >= 12 )) ||
     (( NODE_MAJOR == 20 && NODE_MINOR >= 19 )); then
    NODE_OK=true
    ok "Node.js $NODE_VERSION already installed — skipping"
  else
    warn "Node.js $NODE_VERSION is too old for current Appium 3."
  fi
fi

if [[ "$NODE_OK" != true ]]; then
  if brew list --formula node >/dev/null 2>&1; then
    info "Node formula exists; linking it..."
    brew link --overwrite --force node
  else
    info "Installing Homebrew Node.js..."
    brew install node
  fi

  export PATH="$BREW_PREFIX/bin:$PATH"
fi

have node || fail "Node.js is not available."
have npm || fail "npm is not available."

ok "Node.js: $(node -v)"
ok "npm:      $(npm -v)"

# ── npm global PATH ───────────────────────────────────────────────────
NPM_PREFIX="$(npm prefix -g)"
NPM_GLOBAL_BIN="$NPM_PREFIX/bin"

# Replace the marker comment with the real npm path in the AppClaw block.
python3 - "$ZPROFILE" "$NPM_GLOBAL_BIN" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
bin_dir = sys.argv[2]
text = p.read_text()

old = "# npm global executables are added below after npm is available."
new = f'export PATH="{bin_dir}:$PATH"'

if old in text:
    text = text.replace(old, new)
elif new not in text:
    text += "\n" + new + "\n"

p.write_text(text)
PY

export PATH="$NPM_GLOBAL_BIN:$PATH"

# ── Java LTS ──────────────────────────────────────────────────────────
header "4. OpenJDK LTS"

JAVA_OK=false

if have java; then
  JAVA_VERSION_RAW="$(java -version 2>&1 | head -1)"
  JAVA_MAJOR="$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p')"

  # Java 17+ is suitable for the Appium/Android environment.
  if [[ -n "$JAVA_MAJOR" ]] && (( JAVA_MAJOR >= 17 )); then
    JAVA_OK=true
    ok "$JAVA_VERSION_RAW — skipping"
  else
    warn "Existing Java is older than 17."
  fi
fi

if [[ "$JAVA_OK" != true ]]; then
  # Prefer an LTS formula that Homebrew currently exposes.
  # openjdk@21 is broadly supported and LTS. If unavailable, use
  # Homebrew's current openjdk formula.
  if brew info openjdk@21 >/dev/null 2>&1; then
    JDK_FORMULA="openjdk@21"
  else
    JDK_FORMULA="openjdk"
  fi

  if brew list --formula "$JDK_FORMULA" >/dev/null 2>&1; then
    info "$JDK_FORMULA already installed — skipping package installation"
  else
    info "Installing $JDK_FORMULA..."
    brew install "$JDK_FORMULA"
  fi

  JDK_PREFIX="$(brew --prefix "$JDK_FORMULA")"
  export PATH="$JDK_PREFIX/bin:$PATH"

  if [[ -d "$JDK_PREFIX/libexec/openjdk.jdk" ]]; then
    sudo ln -sfn \
      "$JDK_PREFIX/libexec/openjdk.jdk" \
      "/Library/Java/JavaVirtualMachines/$(basename "$JDK_FORMULA").jdk"
  fi

  JAVA_HOME_VALUE="$JDK_PREFIX/libexec/openjdk.jdk/Contents/Home"
  [[ -d "$JAVA_HOME_VALUE" ]] || JAVA_HOME_VALUE="$JDK_PREFIX"

  export JAVA_HOME="$JAVA_HOME_VALUE"

  python3 - "$ZPROFILE" "$JAVA_HOME_VALUE" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
java_home = sys.argv[2]
text = p.read_text()

marker = "# Java is configured automatically by AppClaw setup."
line = f'export JAVA_HOME="{java_home}"'

# Keep JAVA_HOME inside the AppClaw block.
if line not in text:
    anchor = "# Automatically maintained by AppClaw setup.\n"
    text = text.replace(anchor, anchor + marker + "\n" + line + "\n")

p.write_text(text)
PY

else
  # Existing Java may not have JAVA_HOME in the profile. Detect it.
  JAVA_HOME_VALUE="$(
    /usr/libexec/java_home 2>/dev/null || true
  )"

  if [[ -n "$JAVA_HOME_VALUE" ]]; then
    export JAVA_HOME="$JAVA_HOME_VALUE"
  fi
fi

have java || fail "Java is not available."
ok "Java: $(java -version 2>&1 | head -1)"

# ── Android platform-tools ───────────────────────────────────────────
header "5. Android platform-tools"

if have adb; then
  ok "adb already installed — skipping"
else
  if brew list --formula android-platform-tools >/dev/null 2>&1; then
    ok "android-platform-tools already installed"
  else
    info "Installing Android platform-tools..."
    brew install android-platform-tools
  fi
fi

export PATH="$BREW_PREFIX/bin:$PATH"
have adb || fail "adb is not available."
ok "adb: $(adb version | head -1)"

# ── Android SDK ───────────────────────────────────────────────────────
header "6. Android SDK"

ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

mkdir -p "$ANDROID_HOME"

if [[ -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]]; then
  ok "Android SDK command-line tools already available — skipping"
else
  if brew info --cask android-commandlinetools >/dev/null 2>&1; then
    if brew list --cask android-commandlinetools >/dev/null 2>&1; then
      ok "Android command-line tools already installed"
    else
      info "Installing Android command-line tools..."
      brew install --cask android-commandlinetools
    fi
  else
    warn "Homebrew android-commandlinetools cask is unavailable."
    warn "Install Android Studio to provision the Android SDK."
  fi

  # Search Homebrew's installation for sdkmanager and install it under
  # the conventional Android SDK location when possible.
  SDKMANAGER="$(find "$BREW_PREFIX" -path "*/cmdline-tools/*/bin/sdkmanager" -type f 2>/dev/null | head -1 || true)"

  if [[ -z "$SDKMANAGER" && -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]]; then
    SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
  fi

  if [[ -n "$SDKMANAGER" && ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]]; then
    SDK_ROOT="$(dirname "$(dirname "$(dirname "$SDKMANAGER")")")"
    mkdir -p "$ANDROID_HOME/cmdline-tools"
    rm -rf "$ANDROID_HOME/cmdline-tools/latest"
    cp -R "$SDK_ROOT" "$ANDROID_HOME/cmdline-tools/latest"
  fi
fi

export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

if [[ -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]]; then
  if [[ ! -d "$ANDROID_HOME/licenses" ]]; then
    info "Accepting Android SDK licenses..."
    yes | sdkmanager --licenses >/dev/null 2>&1 || true
  fi
  ok "Android SDK: $ANDROID_HOME"
else
  warn "sdkmanager not found. Android Studio may be required to finish SDK setup."
fi

# ── Appium ────────────────────────────────────────────────────────────
header "7. Appium"

export PATH="$NPM_GLOBAL_BIN:$PATH"

if have appium; then
  ok "Appium $(appium -v) already installed — skipping npm install"
else
  info "Appium not found. Installing latest stable Appium..."

  # npm 11+ can block lifecycle scripts for global installs.
  # Appium's postinstall installs its extensions, so explicitly allow
  # Appium's own install script.
  npm install -g --allow-scripts=appium appium

  export PATH="$NPM_GLOBAL_BIN:$PATH"

  have appium || fail "Appium was installed but is still not on PATH."
  ok "Appium $(appium -v) installed"
fi

# Verify the executable location.
APPIUM_BIN="$(command -v appium || true)"
[[ -n "$APPIUM_BIN" ]] || fail "Appium executable cannot be found."

ok "Appium executable: $APPIUM_BIN"

# ── Appium UiAutomator2 ──────────────────────────────────────────────
header "8. Appium UiAutomator2 driver"

DRIVER_LIST="$(appium driver list --installed 2>/dev/null || true)"
if [[ -n "$DRIVER_LIST" ]]; then
  info "Checking installed Appium drivers..."
else
  warn "Could not read Appium installed-driver list; attempting driver check."
fi

DRIVER_LIST="$(appium driver list --installed 2>/dev/null || true)"

# Appium's output can contain markers such as:
#   uiautomator2@x.x.x [installed]
# Use a simple case-insensitive search for the driver name.
if printf '%s\n' "$DRIVER_LIST" | grep -Eiq 'uiautomator2([@[:space:]:]|$)'; then
  ok "UiAutomator2 already installed — skipping"
else
  info "Installing UiAutomator2..."
  appium driver install uiautomator2
  ok "UiAutomator2 installed"
fi

# ── XCUITest ─────────────────────────────────────────────────────────
header "9. iOS / XCUITest"

if [[ -d "/Applications/Xcode.app" ]]; then
  DRIVER_LIST="$(appium driver list --installed 2>/dev/null || true)"

  if printf '%s\n' "$DRIVER_LIST" | grep -Eiq 'xcuitest([@[:space:]:]|$)'; then
    ok "XCUITest already installed — skipping"
  else
    info "Xcode detected. Installing XCUITest..."
    appium driver install xcuitest
    ok "XCUITest installed"
  fi
else
  warn "Xcode not installed — skipping XCUITest."
fi

# ── AppClaw dependencies ─────────────────────────────────────────────
header "10. AppClaw npm dependencies"

[[ -f package.json ]] || fail "package.json not found in $ROOT"

if [[ -d node_modules ]]; then
  ok "node_modules already exists — skipping npm install"
  info "Run 'npm install' manually if package.json/package-lock.json changed."
else
  info "Installing AppClaw dependencies..."
  npm install
  ok "AppClaw dependencies installed"
fi

# ── .env ──────────────────────────────────────────────────────────────
header "11. Environment file"

if [[ -f .env ]]; then
  ok ".env already exists — skipping"
elif [[ -f .env.example ]]; then
  cp .env.example .env
  ok "Created .env from .env.example"
  warn "Edit .env and add your LLM/API configuration."
else
  warn ".env.example not found — skipping"
fi

# ── Reload persistent profile ─────────────────────────────────────────
header "12. Reload and verify"

# shellcheck disable=SC1090
source "$ZPROFILE"

# Ensure current shell has the final paths.
eval "$("$BREW_PREFIX/bin/brew" shellenv)"
export PATH="$NPM_GLOBAL_BIN:$BREW_PREFIX/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
[[ -n "${JAVA_HOME:-}" ]] && export JAVA_HOME="$JAVA_HOME"

# ── Final verification in fresh login shell ───────────────────────────
VERIFY="$(mktemp)"
cat > "$VERIFY" <<'EOF'
set -e
printf "node:          "; node -v
printf "npm:           "; npm -v
printf "java:          "; java -version 2>&1 | head -1
printf "adb:           "; adb version | head -1
printf "appium:        "; appium -v
printf "appium path:   "; command -v appium
printf "node path:     "; command -v node
printf "JAVA_HOME:     "; printf '%s\n' "${JAVA_HOME:-not set}"
printf "ANDROID_HOME:  "; printf '%s\n' "${ANDROID_HOME:-not set}"
EOF

zsh -lc "source '$ZPROFILE'; bash '$VERIFY'"
rm -f "$VERIFY"

# ── Device check ─────────────────────────────────────────────────────
header "13. Android device check"

DEVICES="$(adb devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1}' || true)"

if [[ -n "$DEVICES" ]]; then
  ok "Connected Android device(s):"
  echo "$DEVICES" | sed 's/^/    /'
else
  warn "No Android device/emulator currently connected."
fi

# ── Summary ───────────────────────────────────────────────────────────
header "Setup complete"

echo
echo -e "${GREEN}${BOLD}✓ AppClaw environment is ready.${NC}"
echo
echo "Versions:"
echo "  Node.js       $(node -v)"
echo "  npm           $(npm -v)"
echo "  Java          $(java -version 2>&1 | head -1)"
echo "  adb           $(adb version | head -1)"
echo "  Appium        $(appium -v)"
echo
echo "Paths:"
echo "  node          $(command -v node)"
echo "  appium        $(command -v appium)"
echo "  JAVA_HOME     ${JAVA_HOME:-not set}"
echo "  ANDROID_HOME  ${ANDROID_HOME:-not set}"
echo
echo "Appium drivers:"
appium driver list --installed || true
echo
echo "Next:"
echo "  Start an Android emulator/device, then run your AppClaw command."
echo
ok "Setup finished successfully."
