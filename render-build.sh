#!/bin/bash
echo "🔧 Starting Render build process..."

# Install Chromium for WhatsApp Web
echo "📥 Installing Chromium..."
apt-get update
apt-get install -y chromium-browser

# Verify Chromium installation
if [ -f "/usr/bin/chromium-browser" ]; then
    echo "✅ Chromium installed successfully at /usr/bin/chromium-browser"
else
    echo "⚠️ Chromium installation may have issues, but continuing..."
fi

echo "🎉 Build process completed!"
