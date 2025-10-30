#!/bin/bash
# Render Build Script for WhatsApp Web.js

echo "🚀 Starting Render build process..."

# Install dependencies
npm install

# Create necessary directories
mkdir -p uploads memory tmp reports sessions data public

# Exit successfully
echo "✅ Build completed successfully"
exit 0
