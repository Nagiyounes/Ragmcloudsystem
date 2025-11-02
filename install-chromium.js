const puppeteer = require('puppeteer');

console.log('🔧 Installing Chromium for WhatsApp Web...');

async function installChromium() {
    try {
        console.log('📥 Downloading Chromium...');
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        console.log('✅ Chromium installed successfully!');
        console.log('🌐 Browser version:', await browser.version());
        
        await browser.close();
        console.log('🎉 Chromium setup completed!');
    } catch (error) {
        console.error('❌ Chromium installation failed:', error.message);
        process.exit(1);
    }
}

installChromium();
