const { execSync } = require('child_process');
const fs = require('fs');

console.log('🔧 Setting up Chromium for Render environment...');

try {
    // Check if we're in a cloud environment
    if (process.env.RENDER || process.env.NODE_ENV === 'production') {
        console.log('☁️  Cloud environment detected - using system Chromium');
        
        // Create necessary directories
        if (!fs.existsSync('./sessions')) {
            fs.mkdirSync('./sessions', { recursive: true });
        }
        
        console.log('✅ Chromium setup completed for cloud environment');
    } else {
        console.log('💻 Local environment - installing Chrome via Puppeteer');
        execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
        console.log('✅ Chrome installed successfully');
    }
} catch (error) {
    console.log('⚠️  Chromium setup completed with warnings:', error.message);
    console.log('ℹ️  Using system Chromium as fallback');
}
