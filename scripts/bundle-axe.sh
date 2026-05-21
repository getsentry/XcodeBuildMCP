#!/bin/bash

# Build script for AXe artifacts
# This script downloads pre-built AXe artifacts from GitHub releases and bundles them

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUNDLED_DIR="$PROJECT_ROOT/bundled"
AXE_LOCAL_DIR="${AXE_LOCAL_DIR:-}"
AXE_TEMP_DIR="/tmp/axe-download-$$"

echo "🔨 Preparing AXe artifacts for bundling..."

# Single source of truth for AXe version (overridable)
# 1) Use $AXE_VERSION if provided in env
# 2) Else, use repo-level pin from .axe-version if present
# 3) Else, fall back to default below
DEFAULT_AXE_VERSION="1.1.1"
VERSION_FILE="$PROJECT_ROOT/.axe-version"
if [ -n "${AXE_VERSION}" ]; then
    PINNED_AXE_VERSION="${AXE_VERSION}"
elif [ -f "$VERSION_FILE" ]; then
    PINNED_AXE_VERSION="$(cat "$VERSION_FILE" | tr -d ' \n\r')"
else
    PINNED_AXE_VERSION="$DEFAULT_AXE_VERSION"
fi
echo "📌 Using AXe version: $PINNED_AXE_VERSION"

# Clean up any existing bundled directory
if [ -d "$BUNDLED_DIR" ]; then
    echo "🧹 Cleaning existing bundled directory..."
    rm -r "$BUNDLED_DIR"
fi

# Create bundled directory
mkdir -p "$BUNDLED_DIR"

USE_LOCAL_AXE=false
AXE_ARCHIVE_FLAVOR="local-signed"
if [ -z "${AXE_FORCE_REMOTE}" ] && [ "${AXE_USE_LOCAL:-0}" = "1" ]; then
    USE_LOCAL_AXE=true
fi

# Use local AXe build only when explicitly requested, otherwise download from GitHub releases.
if [ "$USE_LOCAL_AXE" = true ] && [ -d "$AXE_LOCAL_DIR" ] && [ -f "$AXE_LOCAL_DIR/Package.swift" ]; then
    echo "🏠 Using local AXe source at $AXE_LOCAL_DIR"
    cd "$AXE_LOCAL_DIR"

    # Build AXe in release configuration
    echo "🔨 Building AXe in release configuration..."
    swift build --configuration release

    # Check if build succeeded
    if [ ! -f ".build/release/axe" ]; then
        echo "❌ AXe build failed - binary not found"
        exit 1
    fi

    echo "✅ AXe build completed successfully"

    # Copy binary to bundled directory
    echo "📦 Copying AXe binary..."
    cp ".build/release/axe" "$BUNDLED_DIR/"

    # Fix rpath to find frameworks in Frameworks/ subdirectory
    echo "🔧 Configuring AXe binary rpath for bundled frameworks..."
    install_name_tool -add_rpath "@executable_path/Frameworks" "$BUNDLED_DIR/axe"

    # Create Frameworks directory and copy frameworks
    echo "📦 Copying frameworks..."
    mkdir -p "$BUNDLED_DIR/Frameworks"

    # Copy frameworks with better error handling
    for framework in .build/release/*.framework; do
        if [ -d "$framework" ]; then
            echo "📦 Copying framework: $(basename "$framework")"
            cp -R "$framework" "$BUNDLED_DIR/Frameworks/"

            # Only copy nested frameworks if they exist
            if [ -d "$framework/Frameworks" ]; then
                echo "📦 Found nested frameworks in $(basename "$framework")"
                cp -R "$framework/Frameworks"/* "$BUNDLED_DIR/Frameworks/" 2>/dev/null || true
            fi
        fi
    done
else
    if [ "$USE_LOCAL_AXE" = true ]; then
        echo "❌ AXE_USE_LOCAL=1 requires AXE_LOCAL_DIR to point to a valid AXe checkout"
        echo "   Received AXE_LOCAL_DIR: ${AXE_LOCAL_DIR:-<unset>}"
        exit 1
    fi

    echo "📥 Downloading latest AXe release from GitHub..."

    if [[ "$PINNED_AXE_VERSION" == staging-* ]]; then
        AXE_RELEASE_TAG="$PINNED_AXE_VERSION"
        AXE_ASSET_VERSION="$PINNED_AXE_VERSION"
    else
        AXE_RELEASE_TAG="v${PINNED_AXE_VERSION}"
        AXE_ASSET_VERSION="v${PINNED_AXE_VERSION}"
    fi
    AXE_RELEASE_BASE_URL="https://github.com/cameroncooke/AXe/releases/download/${AXE_RELEASE_TAG}"
    AXE_HOMEBREW_URL="${AXE_RELEASE_BASE_URL}/AXe-macOS-homebrew-${AXE_ASSET_VERSION}.tar.gz"
    AXE_UNIVERSAL_URL="${AXE_RELEASE_BASE_URL}/AXe-macOS-${AXE_ASSET_VERSION}-universal.tar.gz"
    AXE_LEGACY_URL="${AXE_RELEASE_BASE_URL}/AXe-macOS-${AXE_ASSET_VERSION}.tar.gz"

    # Create temp directory
    mkdir -p "$AXE_TEMP_DIR"
    cd "$AXE_TEMP_DIR"

    # Download the release archive.
    # Prefer the Homebrew archive (unsigned, proper framework symlinks) so that
    # Homebrew can cleanly apply its own ad-hoc signatures during installation.
    # Fall back to universal, then legacy.
    if curl -fL -o "axe-release.tar.gz" "$AXE_HOMEBREW_URL"; then
        AXE_ARCHIVE_FLAVOR="homebrew"
        echo "✅ Downloaded AXe homebrew archive"
    elif curl -fL -o "axe-release.tar.gz" "$AXE_UNIVERSAL_URL"; then
        AXE_ARCHIVE_FLAVOR="universal"
        if [ "$(uname -s)" != "Darwin" ]; then
            echo "✅ Downloaded AXe universal archive for non-macOS bundling"
        else
            echo "✅ Downloaded AXe universal archive"
        fi
    else
        echo "⚠️  AXe universal archive unavailable, falling back to legacy archive"
        curl -fL -o "axe-release.tar.gz" "$AXE_LEGACY_URL"
        AXE_ARCHIVE_FLAVOR="legacy-signed"
    fi

    echo "📦 Extracting AXe release archive..."
    tar -xzf "axe-release.tar.gz"

    # Find the extracted directory containing the axe binary
    if [ -f "axe" ] || [ -f "bin/axe" ]; then
        EXTRACTED_DIR="."
    else
        EXTRACTED_DIR=$(find . -maxdepth 2 -type f -name "axe" ! -path "*/skills/*" | head -1 | xargs -I{} dirname {})
        if [ -z "$EXTRACTED_DIR" ]; then
            EXTRACTED_DIR="."
        fi
    fi

    cd "$EXTRACTED_DIR"

    # Copy binary
    if [ -f "axe" ]; then
        echo "📦 Copying AXe binary..."
        cp "axe" "$BUNDLED_DIR/"
        chmod +x "$BUNDLED_DIR/axe"
    elif [ -f "bin/axe" ]; then
        echo "📦 Copying AXe binary from bin/..."
        cp "bin/axe" "$BUNDLED_DIR/"
        chmod +x "$BUNDLED_DIR/axe"
    else
        echo "❌ AXe binary not found in release archive"
        ls -la
        exit 1
    fi

    # Copy frameworks if they exist
    echo "📦 Copying frameworks..."
    mkdir -p "$BUNDLED_DIR/Frameworks"

    if [ -d "Frameworks" ]; then
        cp -R Frameworks/* "$BUNDLED_DIR/Frameworks/"
    elif [ -d "lib" ]; then
        # Look for frameworks in lib directory
        find lib -name "*.framework" -exec cp -R {} "$BUNDLED_DIR/Frameworks/" \;
    else
        echo "⚠️  No frameworks directory found in release archive"
        echo "📂 Contents of release archive:"
        find . -type f -name "*.framework" -o -name "*.dylib" | head -10
    fi
fi

# Verify frameworks were copied
FRAMEWORK_COUNT=$(find "$BUNDLED_DIR/Frameworks" -name "*.framework" | wc -l)
echo "📦 Copied $FRAMEWORK_COUNT frameworks"

# List the frameworks for verification
echo "🔍 Bundled frameworks:"
ls -la "$BUNDLED_DIR/Frameworks/"

# Validate bundled framework structure.
# Catches two regressions that break Homebrew installations:
#   1. Dereferenced symlinks (e.g. cp -r instead of cp -R) cause codesign to
#      report "bundle format is ambiguous (could be app or framework)".
#   2. Pre-signed binaries in the homebrew archive would conflict with
#      Homebrew's own ad-hoc signing step.
validate_framework_bundles() {
    local has_errors=false

    while IFS= read -r framework_path; do
        local fw_name="$(basename "$framework_path" .framework)"

        # Versioned framework must have Versions/A
        if [ ! -d "$framework_path/Versions/A" ]; then
            continue
        fi

        # Versions/Current must be a symlink to A
        if [ -d "$framework_path/Versions/Current" ] && [ ! -L "$framework_path/Versions/Current" ]; then
            echo "❌ $fw_name: Versions/Current is a real directory, expected symlink to A"
            has_errors=true
        fi

        # Top-level binary must be a symlink into Versions/Current/
        if [ -e "$framework_path/$fw_name" ] && [ ! -L "$framework_path/$fw_name" ]; then
            echo "❌ $fw_name: top-level binary is a real file, expected symlink"
            has_errors=true
        fi

        # For the homebrew archive, binaries must be unsigned
        if [ "$AXE_ARCHIVE_FLAVOR" = "homebrew" ]; then
            local fw_binary="$framework_path/Versions/A/$fw_name"
            if [ -f "$fw_binary" ] && codesign -dv "$fw_binary" >/dev/null 2>&1; then
                echo "❌ $fw_name: binary has a code signature but homebrew archive should be unsigned"
                has_errors=true
            fi
        fi
    done < <(find "$BUNDLED_DIR/Frameworks" -name "*.framework" -type d -maxdepth 1)

    if [ "$AXE_ARCHIVE_FLAVOR" = "homebrew" ] && [ -f "$BUNDLED_DIR/axe" ]; then
        if codesign -dv "$BUNDLED_DIR/axe" >/dev/null 2>&1; then
            echo "❌ axe binary has a code signature but homebrew archive should be unsigned"
            has_errors=true
        fi
    fi

    if [ "$has_errors" = true ]; then
        echo "❌ Framework bundle validation failed"
        exit 1
    fi
    echo "✅ Framework bundle structure validated"
}

validate_framework_bundles

ad_hoc_sign_bundled_axe_assets() {
    echo "🔏 Applying ad-hoc signatures to bundled AXe assets..."

    while IFS= read -r framework_path; do
        framework_name="$(basename "$framework_path" .framework)"
        framework_binary="$framework_path/Versions/A/$framework_name"
        if [ ! -f "$framework_binary" ]; then
            framework_binary="$framework_path/Versions/Current/$framework_name"
        fi
        if [ ! -f "$framework_binary" ]; then
            echo "❌ Framework binary not found: $framework_binary"
            exit 1
        fi
        codesign --force --deep --sign - "$framework_binary"
    done < <(find "$BUNDLED_DIR/Frameworks" -name "*.framework" -type d)

    codesign --force --deep --sign - "$BUNDLED_DIR/axe"
}

# Verify binary can run with bundled frameworks (macOS only)
OS_NAME="$(uname -s)"
if [ "$OS_NAME" = "Darwin" ]; then
    if ! codesign -dv "$BUNDLED_DIR/axe" >/dev/null 2>&1; then
        ad_hoc_sign_bundled_axe_assets
    fi

    if [ "$AXE_ARCHIVE_FLAVOR" = "homebrew" ] || [ "$AXE_ARCHIVE_FLAVOR" = "universal" ] || [ "$AXE_ARCHIVE_FLAVOR" = "local-signed" ]; then
        ad_hoc_sign_bundled_axe_assets
        echo "ℹ️ ${AXE_ARCHIVE_FLAVOR} AXe archive detected; using ad-hoc signatures for local runtime compatibility"
    else
        echo "🔏 Verifying AXe signatures..."
        if ! codesign --verify --deep --strict "$BUNDLED_DIR/axe"; then
            echo "❌ Signature verification failed for bundled AXe binary"
            exit 1
        fi

        while IFS= read -r framework_path; do
            framework_name="$(basename "$framework_path" .framework)"
            framework_binary="$framework_path/Versions/A/$framework_name"
            if [ ! -f "$framework_binary" ]; then
                framework_binary="$framework_path/Versions/Current/$framework_name"
            fi
            if [ ! -f "$framework_binary" ]; then
                echo "❌ Framework binary not found: $framework_binary"
                exit 1
            fi
            if ! codesign --verify --deep --strict "$framework_binary"; then
                echo "❌ Signature verification failed for framework binary: $framework_binary"
                exit 1
            fi
        done < <(find "$BUNDLED_DIR/Frameworks" -name "*.framework" -type d)
    fi

    if [ "$AXE_ARCHIVE_FLAVOR" = "homebrew" ] || [ "$AXE_ARCHIVE_FLAVOR" = "universal" ] || [ "$AXE_ARCHIVE_FLAVOR" = "local-signed" ]; then
        echo "ℹ️ Skipping Gatekeeper assessment for ${AXE_ARCHIVE_FLAVOR} AXe archive"
    else
        echo "🛡️ Assessing AXe with Gatekeeper..."
        SPCTL_LOG="$(mktemp)"
        if ! spctl --assess --type execute "$BUNDLED_DIR/axe" 2>"$SPCTL_LOG"; then
            if grep -q "does not seem to be an app" "$SPCTL_LOG"; then
                echo "⚠️  Gatekeeper execute assessment is inconclusive for CLI binaries; continuing"
            else
                cat "$SPCTL_LOG"
                echo "❌ Gatekeeper assessment failed for bundled AXe binary"
                rm "$SPCTL_LOG"
                exit 1
            fi
        fi
        rm "$SPCTL_LOG"
    fi

    echo "🧪 Testing bundled AXe binary..."
    if DYLD_FRAMEWORK_PATH="$BUNDLED_DIR/Frameworks" "$BUNDLED_DIR/axe" --version > /dev/null 2>&1; then
        echo "✅ Bundled AXe binary test passed"
    else
        echo "❌ Bundled AXe binary test failed"
        exit 1
    fi

    # Get AXe version for logging
    AXE_VERSION=$(DYLD_FRAMEWORK_PATH="$BUNDLED_DIR/Frameworks" "$BUNDLED_DIR/axe" --version 2>/dev/null || echo "unknown")
else
    echo "⚠️  Skipping AXe binary verification on non-macOS (detected $OS_NAME)"
    AXE_VERSION="unknown (verification skipped)"
fi

validate_axe_version_metadata() {
    if [ "$AXE_VERSION" = "unknown (verification skipped)" ]; then
        return
    fi

    if [[ "$AXE_VERSION" == *dirty* ]] && [ "${AXE_ALLOW_DIRTY_LOCAL:-0}" != "1" ]; then
        echo "❌ Bundled AXe reports a dirty version: $AXE_VERSION"
        echo "   Rebuild AXe from a clean checkout or set AXE_ALLOW_DIRTY_LOCAL=1 for explicit local testing."
        exit 1
    fi

    if [ "$USE_LOCAL_AXE" = false ]; then
        if [ "$AXE_VERSION" != "$PINNED_AXE_VERSION" ] && [ "$AXE_VERSION" != "v$PINNED_AXE_VERSION" ]; then
            echo "❌ Bundled AXe version '$AXE_VERSION' does not match pinned version '$PINNED_AXE_VERSION'"
            exit 1
        fi
    fi
}

validate_axe_version_metadata

echo "📋 AXe version: $AXE_VERSION"

# Clean up temp directory if it was used
if [ -d "$AXE_TEMP_DIR" ]; then
    echo "🧹 Cleaning up temporary files..."
    rm -r "$AXE_TEMP_DIR"
fi

# Show final bundle size
BUNDLE_SIZE=$(du -sh "$BUNDLED_DIR" | cut -f1)
echo "📊 Final bundle size: $BUNDLE_SIZE"

echo "🎉 AXe bundling completed successfully!"
echo "📁 Bundled artifacts location: $BUNDLED_DIR"
