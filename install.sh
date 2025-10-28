#!/bin/bash
echo "🚀 Starting optimized npm install..."

# Skip puppeteer download in CI
export PUPPETEER_SKIP_DOWNLOAD=true

# Install without optional dependencies
npm ci --production --no-optional --prefer-offline --no-audit --no-fund

echo "✅ Install completed!"
