#!/bin/bash
# HFT "Insane Profit" Bot Launcher
# 
# Usage: ./run_bot.sh
# 
# This script compiles the TypeScript bot (if needed) and runs it.
# It uses the "bot_state.json" file to track daily trades.

# Ensure we are in the project root
cd "$(dirname "$0")"

# Compile
echo "Building Trade Bot..."
npm run build > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo "✅ Build Successful."
else
    echo "❌ Build Failed."
    exit 1
fi

# Run
echo "Executing Bot..."
node dist/trade_bot.js
