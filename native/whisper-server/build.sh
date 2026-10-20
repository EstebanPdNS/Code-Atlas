#!/usr/bin/env bash
# Code Atlas: builds whisper.cpp's `whisper-server` with the Metal backend
# embedded, as one self-contained arm64 binary the desktop app ships in its
# resources. Dictation runs it on 127.0.0.1 to keep Whisper loaded on the GPU.
#
#   native/whisper-server/build.sh   →   native/whisper-server/dist/whisper-server
set -euo pipefail

WHISPER_CPP_TAG="v1.9.5"
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/.source"
build="$here/.build"
dist="$here/dist"

if [[ ! -d "$src/.git" ]]; then
  git clone --depth 1 --branch "$WHISPER_CPP_TAG" https://github.com/ggml-org/whisper.cpp.git "$src"
fi
git -C "$src" fetch --depth 1 origin "refs/tags/$WHISPER_CPP_TAG:refs/tags/$WHISPER_CPP_TAG"
git -C "$src" checkout --quiet "$WHISPER_CPP_TAG"

cmake -S "$src" -B "$build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DGGML_NATIVE=OFF \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DWHISPER_SDL2=OFF
cmake --build "$build" --config Release --target whisper-server -j "$(sysctl -n hw.ncpu)"

mkdir -p "$dist"
cp "$build/bin/whisper-server" "$dist/whisper-server"
strip -x "$dist/whisper-server"
otool -L "$dist/whisper-server"
echo "built $dist/whisper-server ($WHISPER_CPP_TAG)"
