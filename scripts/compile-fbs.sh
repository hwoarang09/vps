#!/bin/bash
# Compile FlatBuffers schemas

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo "🔨 Compiling FlatBuffers schemas..."

# TypeScript
echo "  → Generating TypeScript code..."
./tools/flatc/flatc --ts -o src/generated schema/dev_log.fbs
echo "  ✓ TypeScript code generated: src/generated/vps-dev-log/"

# Python
echo "  → Generating Python code..."
./tools/flatc/flatc --python -o tools/log_parser/generated schema/dev_log.fbs
echo "  ✓ Python code generated: tools/log_parser/generated/VpsDevLog/"

echo "✅ Done!"
