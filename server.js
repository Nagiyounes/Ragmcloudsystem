const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Load environment variables
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// CORS configuration for Socket.io
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

// Create required directories
const directories = ['uploads', 'memory', 'tmp', 'reports', 'sessions', 'data', 'memory/training'];
directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// =============================================
// 🆕 MULTI-USER WHATSAPP ARCHITECTURE
// =============================================

// 🆕 User WhatsApp Sessions Management
const userWhatsAppSessions = new Map(); // Key: userId, Value: session object

// Session object structure:
// {
//   client: null, // The WhatsApp Web.js client instance
//   qrCode: null, // Current QR code string
//   status: 'disconnected', // 'disconnected', 'qr-ready', 'authenticating', 'connected'
//   isConnected: false,
//   isBotStopped: false,
//   clientReplyTimers: new Map(), // User-specific reply timers
//   importedClients: new Set(), // User-specific imported clients
// }

// NEW: User Management Variables
let users = [];
let currentSessions = new Map(); // Track logged in users
const JWT_SECRET = process.env.JWT_SECRET || 'ragmcloud-erp-secret-key-2024';

// Employee Performance Tracking - NOW PER USER
let employeePerformance = {};

// DeepSeek AI Configuration
let deepseekAvailable = false;

console.log('🔑 Initializing DeepSeek AI...');
if (process.env.DEEPSEEK_API_KEY) {
    deepseekAvailable = true;
    console.log('✅ DeepSeek API key found');
} else {
    console.log('❌ DeepSeek API key not found in .env file');
    deepseekAvailable = false;
}

// Comprehensive Company Information
const ragmcloudCompanyInfo = {
    name: "رقم كلاود",
    englishName: "Ragmcloud ERP",
    website: "https://ragmcloud.sa",
    phone: "+966555111222",
    email: "info@ragmcloud.sa",
    address: "الرياض - حي المغرزات - طريق الملك عبد الله",
    workingHours: "من الأحد إلى الخميس - 8 صباحاً إلى 6 مساءً",
    
    // CORRECT PACKAGES from website
    packages: {
        basic: {
            name: "الباقة الأساسية",
            price: "1000 ريال سنوياً",
            users: "مستخدم واحد",
            branches: "فرع واحد",
            storage: "500 ميجابايت",
            invoices: "500 فاتورة شهرياً",
            features: [
                "إدارة العملاء والفواتير",
                "إدارة المبيعات والمشتريات",
                "إدارة المنتجات",
                "إرسال عروض الأسعار",
                "إرسال الفواتير عبر البريد",
                "دعم فني عبر البريد الإلكتروني",
                "تحديثات النظام الدورية",
                "تصدير التقارير إلى Excel",
                "رفع الفواتير الإلكترونية (فاتورة)",
                "الدعم الفني عبر المحادثة"
            ],
            missing: [
                "إدارة المخزون",
                "التقارير المفصلة",
                "الدعم الفني الهاتفي",
                "إدارة صلاحيات المستخدمين",
                "تطبيق الجوال"
            ],
            target: "الأفراد والمشاريع الصغيرة جداً"
        },
        
        advanced: {
            name: "الباقة المتقدمة", 
            price: "1800 ريال سنوياً",
            users: "مستخدمين",
            branches: "فرعين",
            storage: "1 جيجابايت",
            invoices: "1000 فاتورة شهرياً",
            features: [
                "جميع ميزات الباقة الأساسية",
                "إدارة المخزون المتكاملة",
                "تقارير مفصلة (20 تقرير)",
                "دعم فني عبر الهاتف",
                "إدارة صلاحيات المستخدمين",
                "تطبيق الجوال",
                "الفروع والمستخدمين الفرعيين"
            ],
            missing: [
                "التنبيهات الذكية",
                "الربط مع المتاجر الإلكترونية",
                "إدارة متعددة الفروع",
                "ربط النظام بالمحاسب الخارجي",
                "تخصيص واجهة النظام"
            ],
            target: "الشركات الصغيرة والمتوسطة"
        },
        
        professional: {
            name: "الباقة الاحترافية",
            price: "2700 ريال سنوياً", 
            users: "3 مستخدمين",
            branches: "3 فروع",
            storage: "2 جيجابايت",
            invoices: "2000 فاتورة شهرياً",
            features: [
                "جميع ميزات الباقة المتقدمة",
                "تنبيهات ذكية",
                "الربط مع المتاجر الإلكترونية",
                "إدارة متعددة الفروع",
                "ربط النظام بالمحاسب الخارجي",
                "تخصيص واجهة النظام",
                "30 تقرير متاح",
                "تدريب المستخدمين"
            ],
            missing: [
                "استشارات محاسبية مجانية"
            ],
            target: "الشركات المتوسطة والكبيرة"
        },
        
        premium: {
            name: "الباقة المميزة",
            price: "3000 ريال سنوياً",
            users: "3 مستخدمين", 
            branches: "3 فروع",
            storage: "3 جيجابايت",
            invoices: "غير محدود",
            features: [
                "جميع ميزات الباقة الاحترافية",
                "استشارات محاسبية مجانية",
                "فواتير غير محدودة",
                "دعم متميز"
            ],
            target: "الشركات الكبيرة والمؤسسات"
        }
    },

    // Services
    services: {
        accounting: "الحلول المحاسبية المتكاملة",
        inventory: "إدارة المخزون والمستودعات",
        hr: "إدارة الموارد البشرية والرواتب",
        crm: "إدارة علاقات العملاء",
        sales: "إدارة المبيعات والمشتريات", 
        reports: "التقارير والتحليلات الذكية",
        integration: "التكامل مع الأنظمة الحكومية"
    },

    // System Features
    features: [
        "سحابي 100% - لا حاجة لخوادم",
        "واجهة عربية سهلة الاستخدام", 
        "دعم فني على مدار الساعة",
        "تكامل مع الزكاة والضريبة",
        "تقارير ذكية وقابلة للتخصيص",
        "نسخ احتياطي تلقائي",
        "تطبيق جوال متكامل",
        "أمان عالي وحماية بيانات"
    ]
};

// DEFAULT AI System Prompt (will be overridden by saved prompt)
const DEFAULT_AI_SYSTEM_PROMPT = `أنت مساعد ذكي ومحترف تمثل شركة "رقم كلاود" المتخصصة في أنظمة ERP السحابية. أنت بائع مقنع ومحاسب خبير.

🔹 **هويتك:**
- أنت بائع محترف ومحاسب متمرس
- تركيزك على بيع أنظمة ERP وخدمات رقم كلاود فقط
- لا تجيب على أسئلة خارج نطاق تخصصك

🔹 **معلومات الشركة:**
الاسم: رقم كلاود (Ragmcloud ERP)
الموقع: https://ragmcloud.sa  
الهاتف: +966555111222
المقر: الرياض - حي المغرزات

🔹 **باقات الأسعار (سنوية):**
• الباقة الأساسية: 1000 ريال (مستخدم واحد)
• الباقة المتقدمة: 1800 ريال (مستخدمين) 
• الباقة الاحترافية: 2700 ريال (3 مستخدمين)
• الباقة المميزة: 3000 ريال (3 مستخدمين)

🔹 **قواعد الرد الإلزامية:**
1. **لا تجيب أبداً على:** أسئلة شخصية، سياسة، أديان، برامج أخرى، منافسين
2. **إذا سألك عن شيء خارج تخصصك:** قل "أعتذر، هذا السؤال خارج نطاق تخصصي في أنظمة ERP"
3. **كن مقنعاً:** ركز على فوائد النظام للعميل
4. **اسأل عن نشاط العميل:** لتعرف أي باقة تناسبه
5. **شجع على التواصل:** وجه العميل للاتصال بفريق المبيعات

🔹 **نماذج الردود المقنعة:**
- "نظامنا بيوفر عليك 50% من وقتك اليومي في المتابعة المحاسبية"
- "بتقدر تتابع كل فروعك من مكان واحد بدون ما تحتاج تروح لكل فرع"
- "التقارير بتكون جاهزة بشكل فوري علشان تتابع أداء شركتك"
- "جرب النظام مجاناً لمدة 7 أيام وتشوف الفرق بنفسك"

🔹 **كيفية التعامل مع الأسئلة:**
- اسأل عن طبيعة نشاط العميل أولاً
- حدد التحديات التي يواجهها
- اقترح الباقة المناسبة لاحتياجاته
- وجهه للاتصال بفريق المبيعات للتسجيل

تذكر: أنت بائع محترف هدفك مساعدة العملاء في اختيار النظام المناسب لشركاتهم.`;

// 🆕 GLOBAL AI SYSTEM PROMPT (Load from file on startup)
let AI_SYSTEM_PROMPT = loadAIPromptFromFile();

// 🆕 Function to load AI prompt from file
function loadAIPromptFromFile() {
    try {
        if (fs.existsSync('./memory/ai_prompt.txt')) {
            const savedPrompt = fs.readFileSync('./memory/ai_prompt.txt', 'utf8');
            console.log('✅ Loaded AI prompt from file');
            return savedPrompt;
        } else {
            console.log('ℹ️ Using default AI prompt');
            return DEFAULT_AI_SYSTEM_PROMPT;
        }
    } catch (error) {
        console.error('❌ Error loading AI prompt:', error);
        return DEFAULT_AI_SYSTEM_PROMPT;
    }
}

// =============================================
// 🆕 ENHANCEMENT 1: MANUAL CLIENT STATUS ASSIGNMENT
// =============================================

// 🆕 Manual Client Status Update API
app.post('/api/update-client-status', authenticateUser, async (req, res) => {
    try {
        const { phone, status } = req.body;
        const userId = req.user.id;
        
        console.log('🔄 Updating client status:', { phone, status, userId });
        
        if (!phone || !status) {
            return res.status(400).json({ error: 'رقم الهاتف والحالة مطلوبان' });
        }
        
        // Update client status in memory
        let clients = [];
        if (fs.existsSync('./memory/clients.json')) {
            clients = JSON.parse(fs.readFileSync('./memory/clients.json', 'utf8'));
        }
        
        const clientIndex = clients.findIndex(client => client.phone === phone);
        if (clientIndex !== -1) {
            clients[clientIndex].status = status;
            clients[clientIndex].statusUpdatedAt = new Date().toISOString();
            clients[clientIndex].updatedBy = userId;
            
            fs.writeFileSync('./memory/clients.json', JSON.stringify(clients, null, 2));
            
            // Emit to frontend
            io.emit('client_status_updated', {
                phone: phone,
                status: status,
                clients: clients
            });
            
            res.json({ success: true, message: `تم تحديث الحالة إلى: ${getStatusText(status)}` });
        } else {
            res.status(404).json({ error: 'العميل غير موجود' });
        }
    } catch (error) {
        console.error('❌ Error updating client status:', error);
        res.status(500).json({ error: 'فشل تحديث الحالة' });
    }
});

// 🆕 Helper function for status text
function getStatusText(status) {
    const statusMap = {
        'interested': 'مهتم',
        'not-interested': 'غير مهتم', 
        'busy': 'مشغول',
        'no-reply': 'لم يرد'
    };
    return statusMap[status] || status;
}

// =============================================
// 🆕 ENHANCEMENT 2: USER MANAGEMENT APIs
// =============================================

// 🆕 Edit user
app.put('/api/users/:id', authenticateUser, authorizeAdmin, (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { name, username, password, role, isActive } = req.body;
        
        const userIndex = users.findIndex(u => u.id === userId);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }
        
        // Check if username already exists (excluding current user)
        if (username && users.find(u => u.username === username && u.id !== userId)) {
            return res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
        }
        
        // Update user
        if (name) users[userIndex].name = name;
        if (username) users[userIndex].username = username;
        if (password) users[userIndex].password = bcrypt.hashSync(password, 10);
        if (role) users[userIndex].role = role;
        if (isActive !== undefined) users[userIndex].isActive = isActive;
        
        saveUsers();
        
        res.json({
            success: true,
            user: {
                id: users[userIndex].id,
                name: users[userIndex].name,
                username: users[userIndex].username,
                role: users[userIndex].role,
                isActive: users[userIndex].isActive
            },
            message: 'تم تحديث المستخدم بنجاح'
        });
        
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// 🆕 Delete user  
app.delete('/api/users/:id', authenticateUser, authorizeAdmin, (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        
        // Prevent deleting own account
        if (userId === req.user.id) {
            return res.status(400).json({ error: 'لا يمكن حذف حسابك الخاص' });
        }
        
        const userIndex = users.findIndex(u => u.id === userId);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }
        
        // Remove user WhatsApp session
        const userSession = getUserWhatsAppSession(userId);
        if (userSession && userSession.client) {
            userSession.client.destroy();
        }
        userWhatsAppSessions.delete(userId);
        
        // Remove from current sessions
        currentSessions.delete(userId);
        
        // Remove user
        users.splice(userIndex, 1);
        saveUsers();
        
        res.json({ 
            success: true, 
            message: 'تم حذف المستخدم بنجاح' 
        });
        
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// =============================================
// 🆕 ENHANCEMENT 3: AI TRAINING PORTAL APIs
// =============================================

// 🆕 Update AI system prompt
app.put('/api/ai-prompt', authenticateUser, authorizeAdmin, (req, res) => {
    try {
        const { prompt } = req.body;
        
        console.log('🔄 Updating AI prompt:', prompt ? 'Content received' : 'No content');
        
        if (!prompt) {
            return res.status(400).json({ error: 'النص المطلوب مطلوب' });
        }
        
        // Save AI prompt to file
        fs.writeFileSync('./memory/ai_prompt.txt', prompt);
        
        // Update global AI prompt for ALL users
        AI_SYSTEM_PROMPT = prompt;
        
        console.log('✅ AI prompt updated globally for all users');
        
        res.json({ 
            success: true, 
            message: 'تم تحديث نص الذكاء الاصطناعي بنجاح لجميع المستخدمين' 
        });
        
    } catch (error) {
        console.error('Update AI prompt error:', error);
        res.status(500).json({ error: 'خطأ في تحديث النص: ' + error.message });
    }
});

// 🆕 Upload training documents
app.post('/api/ai-training', authenticateUser, authorizeAdmin, upload.single('trainingFile'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
        }
        
        const filePath = req.file.path;
        const fileName = req.file.originalname;
        
        // Process training documents based on file type
        const fileExtension = path.extname(fileName).toLowerCase();
        
        let trainingData = '';
        
        if (fileExtension === '.txt') {
            trainingData = fs.readFileSync(filePath, 'utf8');
        } else if (fileExtension === '.pdf') {
            // For PDF files, you would need a PDF parser library
            trainingData = `PDF file uploaded: ${fileName}. يحتاج معالجة إضافية.`;
        } else if (fileExtension === '.docx' || fileExtension === '.doc') {
            // For Word documents, you would need a DOCX parser library
            trainingData = `Word document uploaded: ${fileName}. يحتاج معالجة إضافية.`;
        } else {
            fs.unlinkSync(filePath);
            return res.status(400).json({ error: 'نوع الملف غير مدعوم' });
        }
        
        // Save training data to memory with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const trainingFile = `./memory/training/training_${timestamp}_${fileName}.txt`;
        fs.writeFileSync(trainingFile, trainingData);
        
        // Clean up uploaded file
        fs.unlinkSync(filePath);
        
        console.log(`✅ Training file saved: ${trainingFile}`);
        
        res.json({ 
            success: true, 
            message: `تم رفع ملف التدريب بنجاح: ${fileName}`,
            fileName: fileName,
            dataLength: trainingData.length,
            savedPath: trainingFile
        });
        
    } catch (error) {
        console.error('AI training upload error:', error);
        
        // Clean up uploaded file
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(500).json({ error: 'فشل رفع ملف التدريب: ' + error.message });
    }
});

// 🆕 Get current AI prompt
app.get('/api/ai-prompt', authenticateUser, authorizeAdmin, (req, res) => {
    try {
        res.json({ 
            success: true, 
            prompt: AI_SYSTEM_PROMPT 
        });
        
    } catch (error) {
        console.error('Error getting AI prompt:', error);
        res.status(500).json({ error: 'خطأ في جلب النص' });
    }
});

// =============================================
// 🆕 MULTI-USER WHATSAPP FUNCTIONS
// =============================================

// 🆕 IMPROVED WhatsApp Client with Better Cloud Support
function initializeUserWhatsApp(userId) {
    console.log(`🔄 Starting WhatsApp for user ${userId}...`);
    
    try {
        // Check if user already has an active session
        if (userWhatsAppSessions.has(userId) && userWhatsAppSessions.get(userId).status === 'connected') {
            console.log(`✅ User ${userId} already has an active WhatsApp session`);
            return userWhatsAppSessions.get(userId);
        }

        // Initialize a new session object
        const userSession = {
            client: null,
            qrCode: null,
            status: 'disconnected',
            isConnected: false,
            isBotStopped: false,
            clientReplyTimers: new Map(),
            importedClients: new Set()
        };
        
        userWhatsAppSessions.set(userId, userSession);

        // 🆕 IMPROVED WhatsApp Client Configuration for Cloud
        userSession.client = new Client({
            authStrategy: new LocalAuth({ 
                clientId: `ragmcloud-user-${userId}`,
                dataPath: `./sessions/user-${userId}` // Separate sessions per user
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--single-process', // 🆕 Important for cloud
                    '--no-zygote',
                    '--disable-setuid-sandbox',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--disable-ipc-flooding-protection',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-back-forward-cache',
                    '--disable-component-extensions-with-background-pages'
                ],
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null // 🆕 For cloud environments
            },
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html' // 🆕 Fixed version
            }
        });

        // 🆕 FIXED QR Code Generation (User-specific)
        userSession.client.on('qr', (qr) => {
            console.log(`📱 QR CODE RECEIVED for user ${userId}`);
            qrcode.generate(qr, { small: true });
            
            // Generate QR code for web interface
            QRCode.toDataURL(qr, (err, url) => {
                if (!err) {
                    userSession.qrCode = url;
                    userSession.status = 'qr-ready';
                    
                    console.log(`✅ QR code generated for user ${userId}`);
                    console.log(`📡 Emitting QR to user_qr_${userId}`);
                    
                    // 🆕 FIXED: Emit to ALL connected clients for this user
                    io.emit(`user_qr_${userId}`, { 
                        qrCode: url,
                        userId: userId,
                        timestamp: new Date().toISOString()
                    });
                    
                    // 🆕 FIXED: Also emit status update
                    io.emit(`user_status_${userId}`, { 
                        connected: false, 
                        message: 'يرجى مسح QR Code للاتصال',
                        status: 'qr-ready',
                        hasQr: true,
                        userId: userId
                    });
                    
                } else {
                    console.error(`❌ QR code generation failed for user ${userId}:`, err);
                    
                    // 🆕 FIXED: Emit error to frontend
                    io.emit(`user_status_${userId}`, { 
                        connected: false, 
                        message: 'فشل توليد QR Code',
                        status: 'error',
                        hasQr: false,
                        userId: userId,
                        error: err.message
                    });
                }
            });
        });

        // 🆕 Ready Event (User-specific)
        userSession.client.on('ready', () => {
            console.log(`✅ WhatsApp READY for user ${userId}!`);
            userSession.isConnected = true;
            userSession.status = 'connected';
            
            // 🆕 Emit user-specific status
            io.emit(`user_status_${userId}`, { 
                connected: true, 
                message: 'واتساب متصل ✅',
                status: 'connected',
                hasQr: false,
                userId: userId
            });
            
            console.log(`✅ User ${userId} WhatsApp connected successfully`);
        });

        // 🆕 Message Event with User-specific Processing
        userSession.client.on('message', async (message) => {
            // Ignore status broadcasts and messages from us
            if (message.from === 'status@broadcast' || message.fromMe) {
                return;
            }

            console.log(`📩 User ${userId} received message from:`, message.from);
            console.log('💬 Message content:', message.body);
            
            try {
                // Store incoming message immediately
                const clientPhone = message.from.replace('@c.us', '');
                storeClientMessage(clientPhone, message.body, false);
                
                // Emit to frontend with user context
                io.emit(`user_message_${userId}`, {
                    from: clientPhone,
                    message: message.body,
                    timestamp: new Date(),
                    fromMe: false,
                    userId: userId
                });

                // Update client last message
                updateClientLastMessage(clientPhone, message.body);

                // Process incoming message with user-specific auto-reply
                processUserIncomingMessage(userId, message.body, message.from).catch(error => {
                    console.error(`❌ Error in processUserIncomingMessage for user ${userId}:`, error);
                });
                
            } catch (error) {
                console.error(`❌ Error handling message for user ${userId}:`, error);
            }
        });

        // 🆕 Authentication Failure (User-specific)
        userSession.client.on('auth_failure', (msg) => {
            console.log(`❌ WhatsApp auth failed for user ${userId}:`, msg);
            userSession.isConnected = false;
            userSession.status = 'disconnected';
            
            io.emit(`user_status_${userId}`, { 
                connected: false, 
                message: 'فشل المصادقة',
                status: 'auth-failed',
                hasQr: false,
                userId: userId
            });
        });

        // 🆕 Disconnected Event (User-specific)
        userSession.client.on('disconnected', (reason) => {
            console.log(`🔌 WhatsApp disconnected for user ${userId}:`, reason);
            userSession.isConnected = false;
            userSession.status = 'disconnected';
            
            io.emit(`user_status_${userId}`, { 
                connected: false, 
                message: 'جارٍ إعادة الاتصال...',
                status: 'disconnected',
                hasQr: false,
                userId: userId
            });
            
            // Auto-reconnect after 10 seconds
            setTimeout(() => {
                console.log(`🔄 Attempting reconnection for user ${userId}...`);
                initializeUserWhatsApp(userId);
            }, 10000);
        });

        // 🆕 Better Error Handling
        userSession.client.on('error', (error) => {
            console.error(`❌ WhatsApp error for user ${userId}:`, error);
        });

        // Start initialization with better error handling
        userSession.client.initialize().catch(error => {
            console.log(`⚠️ WhatsApp init failed for user ${userId}:`, error.message);
            
            // Retry after 15 seconds with exponential backoff
            setTimeout(() => {
                console.log(`🔄 Retrying WhatsApp initialization for user ${userId}...`);
                initializeUserWhatsApp(userId);
            }, 15000);
        });
        
        return userSession;
        
    } catch (error) {
        console.log(`❌ Error creating WhatsApp client for user ${userId}:`, error.message);
        setTimeout(() => initializeUserWhatsApp(userId), 15000);
        return null;
    }
}

// 🆕 Get User WhatsApp Session
function getUserWhatsAppSession(userId) {
    return userWhatsAppSessions.get(userId);
}

// 🆕 Check if User WhatsApp is Connected
function isUserWhatsAppConnected(userId) {
    const session = getUserWhatsAppSession(userId);
    return session && session.isConnected;
}

// 🆕 ENHANCEMENT: AI Response with Real User Identity
async function generateRagmcloudAIResponse(userMessage, clientPhone, userId) {
    console.log('🔄 Processing message for Ragmcloud with memory:', userMessage);
    
    // Get current user info for personalized response
    const currentUser = users.find(u => u.id === userId);
    const userName = currentUser ? currentUser.name : 'مساعد رقم كلاود';
    
    // ALWAYS try DeepSeek first if available
    if (deepseekAvailable) {
        try {
            console.log('🎯 Using DeepSeek with conversation memory...');
            
            const aiResponse = await callDeepSeekAI(userMessage, clientPhone, userName);
            
            console.log('✅ DeepSeek Response successful');
            console.log('💬 AI Reply:', aiResponse);
            return aiResponse;
            
        } catch (error) {
            console.error('❌ DeepSeek API Error:', error.message);
            console.log('🔄 Falling back to enhanced responses...');
            return generateEnhancedRagmcloudResponse(userMessage, clientPhone, userName);
        }
    }
    
    // If DeepSeek not available, use enhanced fallback
    console.log('🤖 DeepSeek not available, using enhanced fallback');
    return generateEnhancedRagmcloudResponse(userMessage, clientPhone, userName);
}

// 🆕 ENHANCEMENT: Update DeepSeek AI call with user identity
async function callDeepSeekAI(userMessage, clientPhone, userName) {
    if (!deepseekAvailable || !process.env.DEEPSEEK_API_KEY) {
        throw new Error('DeepSeek not available');
    }

    try {
        console.log('🚀 Calling DeepSeek API...');
        
        const shouldGreet = shouldSendGreeting(clientPhone);
        const conversationHistory = getConversationHistoryForAI(clientPhone);
        
        // Build messages array with user identity
        const messages = [
            {
                role: "system",
                content: AI_SYSTEM_PROMPT.replace(
                    "أنا مساعد ذكي ومحترف تمثل شركة", 
                    `أنا ${userName} تطوير أعمال من رقم كلاود`
                )
            }
        ];

        // Add conversation history
        if (conversationHistory.length > 0) {
            messages.push(...conversationHistory);
        }

        // Add current user message with context
        messages.push({
            role: "user", 
            content: `العميل يقول: "${userMessage}"
            
${shouldGreet ? 'ملاحظة: هذه بداية المحادثة - ابدأ بالتحية المناسبة' : 'المحادثة مستمرة'}

الرد المطلوب (بلهجة البائع المحترف والمقنع):`
        });

        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: "deepseek-chat",
                messages: messages,
                max_tokens: 500,
                temperature: 0.7,
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`DeepSeek API error: ${response.status}`);
        }

        const data = await response.json();
        
        if (data.choices && data.choices[0] && data.choices[0].message) {
            return data.choices[0].message.content;
        } else {
            throw new Error('Invalid response from DeepSeek');
        }

    } catch (error) {
        console.error('❌ DeepSeek API Error:', error.message);
        throw error;
    }
}

// 🆕 ENHANCEMENT: Update enhanced response with user identity
function generateEnhancedRagmcloudResponse(userMessage, clientPhone, userName) {
    const msg = userMessage.toLowerCase().trim();
    const shouldGreet = shouldSendGreeting(clientPhone);
    
    console.log('🤖 Using enhanced Ragmcloud response for:', msg);
    
    // Check for personal/irrelevant questions - REJECT THEM
    const irrelevantQuestions = [
        'من أنت', 'ما اسمك', 'who are you', 'what is your name',
        'مدير', 'المدير', 'manager', 'owner', 'صاحب',
        'عمرك', 'كم عمرك', 'how old', 'اين تسكن', 'اين تعيش',
        ' politics', 'سياسة', 'دين', 'religion', 'برامج أخرى',
        'منافس', 'منافسين', 'competitor'
    ];
    
    if (irrelevantQuestions.some(q => msg.includes(q))) {
        return `أعتذر، هذا السؤال خارج نطاق تخصصي في أنظمة ERP. يمكنني مساعدتك في اختيار النظام المناسب لشركتك أو الإجابة على استفساراتك حول باقاتنا وخدماتنا.`;
    }
    
    // Greeting only at start or after 5 hours
    if (shouldGreet && (msg.includes('السلام') || msg.includes('سلام') || msg.includes('اهلا') || 
        msg.includes('مرحبا') || msg.includes('اهلين') || msg.includes('مساء') || 
        msg.includes('صباح') || msg.includes('hello') || msg.includes('hi'))) {
        return `السلام عليكم ورحمة الله وبركاته 🌟

أهلاً وسهلاً بك! أنا ${userName} من فريق رقم كلاود ERP.

أنا هنا لمساعدتك في:
• اختيار الباقة المناسبة لشركتك
• شرح ميزات نظام ERP السحابي
• الإجابة على استفساراتك التقنية والمحاسبية

📞 للاستشارة المجانية: +966555111222
🌐 الموقع: ragmcloud.sa

كيف يمكنني مساعدتك اليوم؟`;
    }
    
    // Price/Packages questions
    if (msg.includes('سعر') || msg.includes('تكلفة') || msg.includes('باقة') || 
        msg.includes('package') || msg.includes('price') || msg.includes('كم') || 
        msg.includes('كام') || msg.includes('تعرفة')) {
        
        return `🔄 جاري تحميل معلومات الباقات...

✅ **باقات رقم كلاود السنوية:**

🏷️ **الباقة الأساسية** - 1000 ريال/سنوياً
• مستخدم واحد • فرع واحد • 500 فاتورة/شهر

🏷️ **الباقة المتقدمة** - 1800 ريال/سنوياً  
• مستخدمين • فرعين • 1000 فاتورة/شهر

🏷️ **الباقة الاحترافية** - 2700 ريال/سنوياً
• 3 مستخدمين • 3 فروع • 2000 فاتورة/شهر

🏷️ **الباقة المميزة** - 3000 ريال/سنوياً
• 3 مستخدمين • 3 فروع • فواتير غير محدودة

💡 **لأي باقة تناسبك، أحتاج أعرف:**
• عدد المستخدمين اللي تحتاجهم؟
• كم فرع عندك؟
• طبيعة نشاط شركتك؟

📞 فريق المبيعات جاهز لمساعدتك: +966555111222`;
    }
    
    // Default response - CONVINCING SALES APPROACH
    return `أهلاً وسهلاً بك! 👋

أنت تتحدث مع ${userName} من فريق رقم كلاود المتخصص في أنظمة ERP السحابية.

🎯 **كيف يمكنني مساعدتك؟**

1. **اختيار الباقة المناسبة** لشركتك من بين 4 باقات
2. **شرح الميزات** المحاسبية والإدارية  
3. **ترتيب نسخة تجريبية** مجانية
4. **توصيلك بفريق المبيعات** للاستشارة

💡 **لماذا تختار رقم كلاود؟**
• نظام سحابي 100% - لا تحتاج خوادم
• واجهة عربية سهلة الاستخدام
• دعم فني على مدار الساعة
• توفير وقت وجهد إدارة الشركة

📞 **اتصل الآن للاستشارة المجانية: +966555111222**
🌐 **أو زور موقعنا: ragmcloud.sa**

أخبرني عن طبيعة نشاط شركتك علشان أقدر أساعدك في اختيار النظام المناسب!`;
}

// 🆕 User-specific Message Processing
async function processUserIncomingMessage(userId, message, from) {
    try {
        console.log(`📩 User ${userId} processing message from ${from}: ${message}`);
        
        const clientPhone = from.replace('@c.us', '');
        
        // Store the incoming message
        storeClientMessage(clientPhone, message, false);
        
        // Auto-detect client interest
        autoDetectClientInterest(clientPhone, message);
        
        const userSession = getUserWhatsAppSession(userId);
        if (!userSession) {
            console.log(`❌ No WhatsApp session found for user ${userId}`);
            return;
        }
        
        // Check if user's bot is stopped
        if (userSession.isBotStopped) {
            console.log(`🤖 Bot is stopped for user ${userId} - no auto-reply`);
            return;
        }
        
        // Check if we should reply to this client
        if (!shouldReplyToClient(userId, clientPhone)) {
            console.log(`⏸️ Client not in user ${userId}'s imported list - skipping auto-reply`);
            return;
        }
        
        // Check if we should auto-reply now (3-second delay)
        if (!shouldUserAutoReplyNow(userId, clientPhone)) {
            console.log(`⏰ User ${userId} waiting for 3-second delay before next reply`);
            return;
        }
        
        console.log(`🤖 User ${userId} generating AI response...`);
        
        let aiResponse;
        try {
            // Generate AI response with timeout and user identity
            aiResponse = await Promise.race([
                generateRagmcloudAIResponse(message, clientPhone, userId),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('AI response timeout')), 15000)
                )
            ]);
        } catch (aiError) {
            console.error(`❌ AI response error for user ${userId}:`, aiError.message);
            // Use enhanced fallback response instead of error message
            const currentUser = users.find(u => u.id === userId);
            const userName = currentUser ? currentUser.name : 'مساعد رقم كلاود';
            aiResponse = generateEnhancedRagmcloudResponse(message, clientPhone, userName);
        }
        
        // Send the response using user's WhatsApp client
        await userSession.client.sendMessage(from, aiResponse);
        
        // Store the sent message
        storeClientMessage(clientPhone, aiResponse, true);
        
        // Update user-specific reply timer
        updateUserReplyTimer(userId, clientPhone);
        
        // Track AI reply for the specific user
        if (currentSessions.has(userId)) {
            trackEmployeeActivity(userId, 'ai_reply', { clientPhone: clientPhone });
        }
        
        // Update client last message
        updateClientLastMessage(clientPhone, aiResponse);
        
        // Emit to frontend for the specific user
        io.emit(`user_message_${userId}`, {
            from: clientPhone,
            message: aiResponse,
            timestamp: new Date(),
            fromMe: true,
            userId: userId
        });
        
        console.log(`✅ User ${userId} auto-reply sent to ${clientPhone}`);
        
    } catch (error) {
        console.error(`❌ Error processing incoming message for user ${userId}:`, error);
        
        // Send professional error message instead of technical one
        try {
            const userSession = getUserWhatsAppSession(userId);
            if (userSession && userSession.isConnected) {
                const professionalMessage = "عذراً، يبدو أن هناك تأخير في النظام. يرجى المحاولة مرة أخرى أو التواصل معنا مباشرة على +966555111222";
                await userSession.client.sendMessage(from, professionalMessage);
            }
        } catch (sendError) {
            console.error(`❌ User ${userId} failed to send error message:`, sendError);
        }
    }
}

// 🆕 User-specific Auto-Reply Functions
function shouldReplyToClient(userId, phone) {
    const userSession = getUserWhatsAppSession(userId);
    if (!userSession) return false;
    
    // Check if client is in user's imported list
    return userSession.importedClients.has(phone);
}

function shouldUserAutoReplyNow(userId, phone) {
    const userSession = getUserWhatsAppSession(userId);
    if (!userSession) return true;
    
    const lastReplyTime = userSession.clientReplyTimers.get(phone);
    if (!lastReplyTime) return true;
    
    const timeDiff = Date.now() - lastReplyTime;
    return timeDiff >= 3000; // 3 seconds minimum between replies
}

function updateUserReplyTimer(userId, phone) {
    const userSession = getUserWhatsAppSession(userId);
    if (userSession) {
        userSession.clientReplyTimers.set(phone, Date.now());
    }
}

// 🆕 User-specific Bot Control
function toggleUserBot(userId, stop) {
    const userSession = getUserWhatsAppSession(userId);
    if (userSession) {
        userSession.isBotStopped = stop;
        console.log(`🤖 User ${userId} bot ${stop ? 'stopped' : 'started'}`);
        
        // Emit user-specific bot status
        io.emit(`user_bot_status_${userId}`, { stopped: stop, userId: userId });
        
        return true;
    }
    return false;
}

// 🆕 User-specific WhatsApp Reconnection
function manualReconnectUserWhatsApp(userId) {
    console.log(`🔄 Manual reconnection requested for user ${userId}...`);
    const userSession = getUserWhatsAppSession(userId);
    
    if (userSession && userSession.client) {
        userSession.client.destroy().then(() => {
            setTimeout(() => initializeUserWhatsApp(userId), 2000);
        });
    } else {
        initializeUserWhatsApp(userId);
    }
}

// =============================================
// EXISTING FUNCTIONS (Updated for Multi-User)
// =============================================

// NEW: User Management Functions
function initializeUsers() {
    const usersFile = './data/users.json';
    
    try {
        if (fs.existsSync(usersFile)) {
            const usersData = fs.readFileSync(usersFile, 'utf8');
            users = JSON.parse(usersData);
            console.log(`✅ Loaded ${users.length} users from file`);
        } else {
            // Create default admin user
            const defaultPassword = bcrypt.hashSync('admin123', 10);
            users = [
                {
                    id: 1,
                    name: 'المدير',
                    username: 'admin',
                    password: defaultPassword,
                    role: 'admin',
                    isActive: true,
                    createdAt: new Date().toISOString(),
                    lastLogin: null
                },
                {
                    id: 2,
                    name: 'محمد أحمد',
                    username: 'mohamed',
                    password: bcrypt.hashSync('user123', 10),
                    role: 'standard',
                    isActive: true,
                    createdAt: new Date().toISOString(),
                    lastLogin: null
                }
            ];
            saveUsers();
            console.log('✅ Created default users');
        }
    } catch (error) {
        console.error('❌ Error initializing users:', error);
        users = [];
    }
}

function saveUsers() {
    try {
        const usersFile = './data/users.json';
        fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
    } catch (error) {
        console.error('❌ Error saving users:', error);
    }
}

function generateToken(user) {
    return jwt.sign(
        { 
            userId: user.id, 
            username: user.username,
            role: user.role 
        },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}

function authenticateUser(req, res, next) {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ error: 'الوصول مرفوض. لا يوجد token.' });
    }
    
    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ error: 'Token غير صالح.' });
    }
    
    const user = users.find(u => u.id === decoded.userId && u.isActive);
    if (!user) {
        return res.status(401).json({ error: 'المستخدم غير موجود.' });
    }
    
    req.user = user;
    next();
}

function authorizeAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'غير مصرح بالوصول. تحتاج صلاحيات مدير.' });
    }
    next();
}

// NEW: Initialize user-specific performance tracking
function initializeUserPerformance(userId) {
    if (!employeePerformance[userId]) {
        employeePerformance[userId] = {
            dailyStats: {
                date: new Date().toISOString().split('T')[0],
                messagesSent: 0,
                clientsContacted: 0,
                aiRepliesSent: 0,
                bulkCampaigns: 0,
                interestedClients: 0,
                startTime: new Date().toISOString(),
                lastActivity: new Date().toISOString()
            },
            clientInteractions: new Map(),
            messageHistory: []
        };
    }
    
    // Check if it's a new day
    const today = new Date().toISOString().split('T')[0];
    if (employeePerformance[userId].dailyStats.date !== today) {
        resetUserDailyStats(userId);
    }
}

function resetUserDailyStats(userId) {
    employeePerformance[userId] = {
        dailyStats: {
            date: new Date().toISOString().split('T')[0],
            messagesSent: 0,
            clientsContacted: 0,
            aiRepliesSent: 0,
            bulkCampaigns: 0,
            interestedClients: 0,
            startTime: new Date().toISOString(),
            lastActivity: new Date().toISOString()
        },
        clientInteractions: new Map(),
        messageHistory: []
    };
    saveUserPerformanceData(userId);
}

// NEW: Track employee activity per user
function trackEmployeeActivity(userId, type, data = {}) {
    if (!employeePerformance[userId]) {
        initializeUserPerformance(userId);
    }
    
    const userPerf = employeePerformance[userId];
    userPerf.dailyStats.lastActivity = new Date().toISOString();
    
    switch (type) {
        case 'message_sent':
            userPerf.dailyStats.messagesSent++;
            if (!userPerf.clientInteractions.has(data.clientPhone)) {
                userPerf.dailyStats.clientsContacted++;
                userPerf.clientInteractions.set(data.clientPhone, {
                    firstContact: new Date().toISOString(),
                    messageCount: 0,
                    lastMessage: new Date().toISOString(),
                    interested: false
                });
            }
            const clientData = userPerf.clientInteractions.get(data.clientPhone);
            clientData.messageCount++;
            clientData.lastMessage = new Date().toISOString();
            break;
            
        case 'ai_reply':
            userPerf.dailyStats.aiRepliesSent++;
            break;
            
        case 'bulk_campaign':
            userPerf.dailyStats.bulkCampaigns++;
            break;
            
        case 'client_interested':
            userPerf.dailyStats.interestedClients++;
            if (userPerf.clientInteractions.has(data.clientPhone)) {
                userPerf.clientInteractions.get(data.clientPhone).interested = true;
            }
            break;
    }
    
    userPerf.messageHistory.push({
        timestamp: new Date().toISOString(),
        type: type,
        ...data
    });
    
    // Check if we should auto-send report to manager (after 30 messages)
    checkAutoSendReport(userId);
    
    // Save performance data
    saveUserPerformanceData(userId);
}

// NEW: Save user performance data
function saveUserPerformanceData(userId) {
    try {
        if (employeePerformance[userId]) {
            const performanceData = {
                ...employeePerformance[userId],
                clientInteractions: Array.from(employeePerformance[userId].clientInteractions.entries())
            };
            fs.writeFileSync(`./memory/employee_performance_${userId}.json`, JSON.stringify(performanceData, null, 2));
        }
    } catch (error) {
        console.error('Error saving performance data for user', userId, error);
    }
}

// NEW: Load user performance data
function loadUserPerformanceData(userId) {
    try {
        const filePath = `./memory/employee_performance_${userId}.json`;
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            employeePerformance[userId] = {
                ...data,
                clientInteractions: new Map(data.clientInteractions || [])
            };
            
            // Check if it's a new day
            const today = new Date().toISOString().split('T')[0];
            if (employeePerformance[userId].dailyStats.date !== today) {
                resetUserDailyStats(userId);
            }
        } else {
            initializeUserPerformance(userId);
        }
    } catch (error) {
        console.error('Error loading performance data for user', userId, error);
        initializeUserPerformance(userId);
    }
}

// NEW: Generate user-specific performance report
function generateUserPerformanceReport(userId) {
    if (!employeePerformance[userId]) {
        initializeUserPerformance(userId);
    }
    
    const stats = employeePerformance[userId].dailyStats;
    const totalInteractions = stats.messagesSent + stats.aiRepliesSent;
    const interestRate = stats.clientsContacted > 0 ? (stats.interestedClients / stats.clientsContacted * 100).toFixed(1) : 0;
    
    // Calculate performance score (0-100)
    let performanceScore = 0;
    performanceScore += Math.min(stats.messagesSent * 2, 30); // Max 30 points for messages
    performanceScore += Math.min(stats.clientsContacted * 5, 30); // Max 30 points for clients
    performanceScore += Math.min(stats.interestedClients * 10, 40); // Max 40 points for interested clients
    
    // Performance evaluation
    let performanceLevel = 'ضعيف';
    let improvementSuggestions = [];
    
    if (performanceScore >= 80) {
        performanceLevel = 'ممتاز';
    } else if (performanceScore >= 60) {
        performanceLevel = 'جيد جداً';
    } else if (performanceScore >= 40) {
        performanceLevel = 'جيد';
    } else if (performanceScore >= 20) {
        performanceLevel = 'مقبول';
    }
    
    // Generate improvement suggestions
    if (stats.messagesSent < 10) {
        improvementSuggestions.push('• زيادة عدد الرسائل المرسلة');
    }
    if (stats.clientsContacted < 5) {
        improvementSuggestions.push('• التواصل مع المزيد من العملاء');
    }
    if (stats.interestedClients < 2) {
        improvementSuggestions.push('• تحسين جودة المحادثات لجذب عملاء مهتمين');
    }
    if (stats.aiRepliesSent < stats.messagesSent * 0.3) {
        improvementSuggestions.push('• الاستفادة أكثر من الذكاء الاصطناعي في الردود');
    }
    
    if (improvementSuggestions.length === 0) {
        improvementSuggestions.push('• الاستمرار في الأداء المتميز');
    }
    
    const user = users.find(u => u.id === userId);
    const userName = user ? user.name : 'مستخدم غير معروف';
    
    const report = `
📊 **تقرير أداء الموظف - ${stats.date}**
👤 **المستخدم:** ${userName}

🕒 **الإحصاءات العامة:**
• 📨 الرسائل المرسلة: ${stats.messagesSent}
• 👥 العملاء المتواصل معهم: ${stats.clientsContacted}
• 🤖 الردود الآلية: ${stats.aiRepliesSent}
• 📢 الحملات الجماعية: ${stats.bulkCampaigns}
• 💼 العملاء المهتمين: ${stats.interestedClients}
• 📈 معدل الاهتمام: ${interestRate}%

🎯 **التقييم:**
• النقاط: ${performanceScore}/100
• المستوى: ${performanceLevel}

📋 **ملخص الأداء:**
${performanceScore >= 80 ? '✅ أداء متميز في التواصل مع العملاء' : 
  performanceScore >= 60 ? '☑️ أداء جيد يحتاج لتحسين بسيط' :
  performanceScore >= 40 ? '📝 أداء مقبول يحتاج لتطوير' :
  '⚠️ يحتاج تحسين في الأداء'}

💡 **اقتراحات للتحسين:**
${improvementSuggestions.join('\n')}

⏰ **نشاط اليوم:**
• بدء العمل: ${new Date(stats.startTime).toLocaleTimeString('ar-SA')}
• آخر نشاط: ${new Date(stats.lastActivity).toLocaleTimeString('ar-SA')}
• المدة النشطة: ${calculateActiveHours(stats.startTime, stats.lastActivity)}

📞 **للمزيد من التفاصيل:** 
يمكن مراجعة التقارير التفصيلية في النظام
    `.trim();
    
    return report;
}

// NEW: Check if we should auto-send report to manager
function checkAutoSendReport(userId) {
    if (!employeePerformance[userId]) return;
    
    const messageCount = employeePerformance[userId].dailyStats.messagesSent;
    
    // Auto-send report after every 30 messages
    if (messageCount > 0 && messageCount % 30 === 0) {
        console.log(`📊 Auto-sending report for user ${userId} after ${messageCount} messages...`);
        
        // Send notification to frontend
        io.emit('auto_report_notification', {
            userId: userId,
            messageCount: messageCount,
            message: `تم إرسال ${messageCount} رسالة. جاري إرسال التقرير التلقائي إلى المدير...`
        });
        
        // Auto-send report
        setTimeout(() => {
            sendReportToManager(userId).catch(error => {
                console.error('❌ Auto-report failed for user', userId, error);
            });
        }, 3000);
    }
}

// Function to determine if greeting should be sent
function shouldSendGreeting(phone) {
    try {
        const messages = getClientMessages(phone);
        if (messages.length === 0) {
            return true; // First message in conversation
        }
        
        // Find the last message timestamp
        const lastMessage = messages[messages.length - 1];
        const lastMessageTime = new Date(lastMessage.timestamp);
        const currentTime = new Date();
        const hoursDiff = (currentTime - lastMessageTime) / (1000 * 60 * 60);
        
        // Return true if more than 5 hours passed
        return hoursDiff > 5;
    } catch (error) {
        console.error('Error checking greeting condition:', error);
        return true; // Default to greeting if error
    }
}

// FIXED: Check if we should auto-reply to client (REPLY TO ALL CLIENTS)
function shouldReplyToClient(userId, phone) {
    const userSession = getUserWhatsAppSession(userId);
    if (!userSession) return false;
    
    // Check if client is in user's imported list
    return userSession.importedClients.has(phone);
}

// Check if we should auto-reply to client (3-second delay)
function shouldUserAutoReplyNow(userId, phone) {
    const userSession = getUserWhatsAppSession(userId);
    if (!userSession) return true;
    
    const lastReplyTime = userSession.clientReplyTimers.get(phone);
    if (!lastReplyTime) return true;
    
    const timeDiff = Date.now() - lastReplyTime;
    return timeDiff >= 3000; // 3 seconds minimum between replies
}

// Update client reply timer
function updateUserReplyTimer(userId, phone) {
    const userSession = getUserWhatsAppSession(userId);
    if (userSession) {
        userSession.clientReplyTimers.set(phone, Date.now());
    }
}

// Auto-detect client interest based on message content
function autoDetectClientInterest(phone, message) {
    try {
        const msg = message.toLowerCase();
        
        // Keywords for different interest levels
        const interestedKeywords = ['سعر', 'تكلفة', 'عرض', 'خصم', 'تجربة', 'جرب', 'مميزات', 'تفاصيل', 'متى', 'كيف', 'أرغب', 'أريد', 'شرح', 'شرح', 'تكلم', 'اتصل', 'تواصل'];
        const busyKeywords = ['لاحقاً', 'مشغول', 'بعدين', 'لاحقا', 'الوقت', 'منشغل', 'مشغول', 'شغل', 'دور', 'وظيفة'];
        const notInterestedKeywords = ['لا أريد', 'غير مهتم', 'لا أرغب', 'شكراً', 'لا شكر', 'ما ابغى', 'ما ابي', 'كفاية', 'توقف', 'لا تتصل', 'بلوك'];
        
        let newStatus = 'no-reply';
        
        if (interestedKeywords.some(keyword => msg.includes(keyword))) {
            newStatus = 'interested';
        } else if (busyKeywords.some(keyword => msg.includes(keyword))) {
            newStatus = 'busy';
        } else if (notInterestedKeywords.some(keyword => msg.includes(keyword))) {
            newStatus = 'not-interested';
        }
        
        // Update client status in memory
        updateClientStatus(phone, newStatus);
        
        return newStatus;
    } catch (error) {
        console.error('Error auto-detecting client interest:', error);
        return 'no-reply';
    }
}

// Update client status in memory
function updateClientStatus(phone, status) {
    try {
        let clients = [];
        const clientsFile = './memory/clients.json';
        
        if (fs.existsSync(clientsFile)) {
            const clientsData = fs.readFileSync(clientsFile, 'utf8');
            clients = JSON.parse(clientsData);
        }

        const clientIndex = clients.findIndex(client => client.phone === phone);
        if (clientIndex !== -1) {
            clients[clientIndex].status = status;
            clients[clientIndex].statusUpdatedAt = new Date().toISOString();
            fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));
            
            // Emit status update to frontend
            io.emit('client_status_updated', {
                phone: phone,
                status: status,
                clients: clients
            });
            
            console.log(`🔄 Auto-updated client ${phone} status to: ${status}`);
        }
    } catch (error) {
        console.error('Error updating client status:', error);
    }
}

// ENHANCED: Get conversation history for AI context
function getConversationHistoryForAI(phone, maxMessages = 10) {
    try {
        const messages = getClientMessages(phone);
        
        // Get recent messages (last 10 messages for context)
        const recentMessages = messages.slice(-maxMessages);
        
        // Format conversation history for AI
        const conversationHistory = recentMessages.map(msg => {
            const role = msg.fromMe ? 'assistant' : 'user';
            return {
                role: role,
                content: msg.message
            };
        });
        
        console.log(`📚 Loaded ${conversationHistory.length} previous messages for context`);
        return conversationHistory;
    } catch (error) {
        console.error('Error getting conversation history:', error);
        return [];
    }
}

// ENHANCED: Store messages per client with better reliability
function storeClientMessage(phone, message, isFromMe) {
    try {
        const messageData = {
            message: message,
            fromMe: isFromMe,
            timestamp: new Date().toISOString()
        };

        let clientMessages = [];
        const messageFile = `./memory/messages_${phone}.json`;
        
        // Ensure memory directory exists
        if (!fs.existsSync('./memory')) {
            fs.mkdirSync('./memory', { recursive: true });
        }
        
        if (fs.existsSync(messageFile)) {
            try {
                const messagesData = fs.readFileSync(messageFile, 'utf8');
                clientMessages = JSON.parse(messagesData);
            } catch (error) {
                console.error('Error reading message file:', error);
                clientMessages = [];
            }
        }

        clientMessages.push(messageData);
        
        // Keep only last 50 messages to prevent file bloat
        if (clientMessages.length > 50) {
            clientMessages = clientMessages.slice(-50);
        }
        
        fs.writeFileSync(messageFile, JSON.stringify(clientMessages, null, 2));
        
        console.log(`💾 Stored message for ${phone} (${isFromMe ? 'sent' : 'received'})`);
        
    } catch (error) {
        console.error('Error storing client message:', error);
    }
}

// ENHANCED: Get client messages with error handling
function getClientMessages(phone) {
    try {
        const messageFile = `./memory/messages_${phone}.json`;
        
        if (fs.existsSync(messageFile)) {
            const messagesData = fs.readFileSync(messageFile, 'utf8');
            return JSON.parse(messagesData);
        }
    } catch (error) {
        console.error('Error getting client messages:', error);
    }
    
    return [];
}

// Phone number formatting
function formatPhoneNumber(phone) {
    if (!phone) return '';
    let cleaned = phone.toString().replace(/\D/g, '');
    
    if (cleaned.startsWith('0')) {
        cleaned = '966' + cleaned.substring(1);
    } else if (cleaned.startsWith('+966')) {
        cleaned = cleaned.substring(1);
    } else if (cleaned.startsWith('966')) {
        // Already in correct format
    } else if (cleaned.length === 9) {
        cleaned = '966' + cleaned;
    }
    
    return cleaned;
}

// Enhanced Excel file processing
function processExcelFile(filePath) {
    try {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const clients = jsonData.map((row, index) => {
            // Try multiple possible column names for name and phone
            const name = row['Name'] || row['name'] || row['الاسم'] || row['اسم'] || 
                         row['اسم العميل'] || row['Client Name'] || row['client_name'] || 
                         `عميل ${index + 1}`;
            
            const phone = formatPhoneNumber(
                row['Phone'] || row['phone'] || row['الهاتف'] || row['هاتف'] || 
                row['رقم الجوال'] || row['جوال'] || row['Phone Number'] || 
                row['phone_number'] || row['رقم الهاتف'] || row['mobile'] || 
                row['Mobile'] || row['الجوال']
            );
            
            return {
                id: index + 1,
                name: name,
                phone: phone,
                lastMessage: 'لم يتم المراسلة بعد',
                unread: 0,
                importedAt: new Date().toISOString(),
                lastActivity: new Date().toISOString(),
                status: 'no-reply'
            };
        }).filter(client => {
            // Filter only valid phone numbers
            return client.phone && client.phone.length >= 10;
        });

        console.log('✅ Processed clients:', clients.length);
        
        return clients;
    } catch (error) {
        console.error('❌ Error processing Excel file:', error);
        throw error;
    }
}

// Update client last message
function updateClientLastMessage(phone, message) {
    try {
        let clients = [];
        const clientsFile = './memory/clients.json';
        
        if (fs.existsSync(clientsFile)) {
            const clientsData = fs.readFileSync(clientsFile, 'utf8');
            clients = JSON.parse(clientsData);
        }

        const clientIndex = clients.findIndex(client => client.phone === phone);
        if (clientIndex !== -1) {
            clients[clientIndex].lastMessage = message.substring(0, 50) + (message.length > 50 ? '...' : '');
            clients[clientIndex].lastActivity = new Date().toISOString();
            fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));
            io.emit('clients_updated', clients);
        }
    } catch (error) {
        console.error('Error updating client last message:', error);
    }
}

// Send report to manager
async function sendReportToManager(userId = null) {
    try {
        let report;
        if (userId) {
            report = generateUserPerformanceReport(userId);
        } else {
            // Generate combined report for all users
            report = "📊 **تقرير أداء الفريق الكامل**\n\n";
            currentSessions.forEach((session, uid) => {
                if (session.isActive) {
                    report += generateUserPerformanceReport(uid) + "\n\n" + "=".repeat(50) + "\n\n";
                }
            });
        }
        
        const managerPhone = '966531304279@c.us';
        
        console.log('📤 Sending report to manager:', managerPhone);
        
        // Find any connected user to send the report
        let senderSession = null;
        for (const [uid, session] of userWhatsAppSessions) {
            if (session.isConnected) {
                senderSession = session;
                break;
            }
        }
        
        if (!senderSession) {
            throw new Error('لا يوجد مستخدم متصل بواتساب لإرسال التقرير');
        }
        
        await senderSession.client.sendMessage(managerPhone, report);
        
        console.log('✅ Report sent to manager successfully');
        return true;
    } catch (error) {
        console.error('❌ Error sending report to manager:', error);
        throw error;
    }
}

// Export report to file
function exportReportToFile(userId = null) {
    try {
        let report, fileName;
        
        if (userId) {
            report = generateUserPerformanceReport(userId);
            const user = users.find(u => u.id === userId);
            fileName = `employee_report_${user ? user.username : 'user'}_${employeePerformance[userId]?.dailyStats.date || 'unknown'}_${Date.now()}.txt`;
        } else {
            report = "📊 **تقرير أداء الفريق الكامل**\n\n";
            currentSessions.forEach((session, uid) => {
                if (session.isActive) {
                    report += generateUserPerformanceReport(uid) + "\n\n" + "=".repeat(50) + "\n\n";
                }
            });
            fileName = `team_report_${new Date().toISOString().split('T')[0]}_${Date.now()}.txt`;
        }
        
        const filePath = path.join(__dirname, 'reports', fileName);
        
        // Ensure reports directory exists
        if (!fs.existsSync(path.join(__dirname, 'reports'))) {
            fs.mkdirSync(path.join(__dirname, 'reports', { recursive: true });
        }
        
        fs.writeFileSync(filePath, report, 'utf8');
        console.log('✅ Report exported to file successfully');
        
        return {
            success: true,
            fileName: fileName,
            filePath: filePath,
            report: report
        };
    } catch (error) {
        console.error('❌ Error exporting report:', error);
        throw error;
    }
}

// Calculate active hours
function calculateActiveHours(startTime, endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const diffMs = end - start;
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours} ساعة ${minutes} دقيقة`;
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// NEW: Authentication Routes
app.post('/api/login', (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
        }
        
        const user = users.find(u => u.username === username && u.isActive);
        if (!user) {
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }
        
        const isPasswordValid = bcrypt.compareSync(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }
        
        // Update last login
        user.lastLogin = new Date().toISOString();
        saveUsers();
        
        // Initialize user performance tracking
        initializeUserPerformance(user.id);
        loadUserPerformanceData(user.id);
        
        // 🆕 Initialize user WhatsApp session
        initializeUserWhatsApp(user.id);
        
        // Create session
        const token = generateToken(user);
        currentSessions.set(user.id, {
            user: user,
            token: token,
            isActive: true,
            loginTime: new Date().toISOString()
        });
        
        res.json({
            success: true,
            token: token,
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                role: user.role
            },
            message: 'تم تسجيل الدخول بنجاح'
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

app.post('/api/logout', authenticateUser, (req, res) => {
    try {
        const userId = req.user.id;
        
        // 🆕 Clean up user WhatsApp session
        const userSession = getUserWhatsAppSession(userId);
        if (userSession && userSession.client) {
            userSession.client.destroy();
        }
        userWhatsAppSessions.delete(userId);
        
        currentSessions.delete(userId);
        res.json({ success: true, message: 'تم تسجيل الخروج بنجاح' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

app.get('/api/me', authenticateUser, (req, res) => {
    res.json({
        success: true,
        user: {
            id: req.user.id,
            name: req.user.name,
            username: req.user.username,
            role: req.user.role
        }
    });
});

// 🆕 User WhatsApp Status Route
app.get('/api/user-whatsapp-status', authenticateUser, (req, res) => {
    try {
        const userId = req.user.id;
        const userSession = getUserWhatsAppSession(userId);
        
        if (!userSession) {
            return res.json({
                connected: false,
                status: 'disconnected',
                message: 'جارٍ تهيئة واتساب...'
            });
        }
        
        res.json({
            connected: userSession.isConnected,
            status: userSession.status,
            message: userSession.isConnected ? 'واتساب متصل ✅' : 
                    userSession.status === 'qr-ready' ? 'يرجى مسح QR Code' :
                    'جارٍ الاتصال...',
            hasQr: !!userSession.qrCode
        });
    } catch (error) {
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// 🆕 User WhatsApp QR Code Route
app.get('/api/user-whatsapp-qr', authenticateUser, (req, res) => {
    try {
        const userId = req.user.id;
        const userSession = getUserWhatsAppSession(userId);
        
        if (!userSession || !userSession.qrCode) {
            return res.status(404).json({ error: 'QR Code غير متوفر' });
        }
        
        res.json({ qrCode: userSession.qrCode });
    } catch (error) {
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// 🆕 User-specific Bot Control Route
app.post('/api/user-toggle-bot', authenticateUser, (req, res) => {
    try {
        const { stop } = req.body;
        const userId = req.user.id;
        
        const success = toggleUserBot(userId, stop);
        
        if (!success) {
            return res.status(400).json({ error: 'فشل في التحكم بالبوت' });
        }
        
        res.json({ 
            success: true, 
            stopped: stop,
            message: `تم ${stop ? 'إيقاف' : 'تشغيل'} البوت بنجاح`
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 🆕 User-specific WhatsApp Reconnection
app.post('/api/user-reconnect-whatsapp', authenticateUser, (req, res) => {
    try {
        const userId = req.user.id;
        manualReconnectUserWhatsApp(userId);
        res.json({ success: true, message: 'جارٍ إعادة الاتصال...' });
    } catch (error) {
        res.status(500).json({ error: 'فشل إعادة الاتصال' });
    }
});

// NEW: User Management Routes (Admin only)
app.get('/api/users', authenticateUser, authorizeAdmin, (req, res) => {
    try {
        const usersList = users.map(user => ({
            id: user.id,
            name: user.name,
            username: user.username,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin
        }));
        
        res.json({ success: true, users: usersList });
    } catch (error) {
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

app.post('/api/users', authenticateUser, authorizeAdmin, (req, res) => {
    try {
        const { name, username, password, role } = req.body;
        
        if (!name || !username || !password) {
            return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
        }
        
        // Check if username already exists
        if (users.find(u => u.username === username)) {
            return res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
        }
        
        const newUser = {
            id: Date.now(),
            name: name,
            username: username,
            password: bcrypt.hashSync(password, 10),
            role: role || 'standard',
            isActive: true,
            createdAt: new Date().toISOString(),
            lastLogin: null
        };
        
        users.push(newUser);
        saveUsers();
        
        // Initialize performance tracking for new user
        initializeUserPerformance(newUser.id);
        
        res.json({
            success: true,
            user: {
                id: newUser.id,
                name: newUser.name,
                username: newUser.username,
                role: newUser.role,
                isActive: newUser.isActive
            },
            message: 'تم إضافة المستخدم بنجاح'
        });
        
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Upload Excel file
app.post('/api/upload-excel', authenticateUser, upload.single('excelFile'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
        }

        console.log('📂 Processing uploaded file:', req.file.originalname);
        
        const clients = processExcelFile(req.file.path);

        if (clients.length === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ 
                error: 'لم يتم العثور على بيانات صالحة في الملف' 
            });
        }

        // 🆕 Add clients to user's imported list
        const userId = req.user.id;
        const userSession = getUserWhatsAppSession(userId);
        if (userSession) {
            clients.forEach(client => {
                userSession.importedClients.add(client.phone);
            });
        }

        // Save clients to file
        fs.writeFileSync('./memory/clients.json', JSON.stringify(clients, null, 2));
        fs.unlinkSync(req.file.path); // Clean up uploaded file

        // Emit to all connected clients
        io.emit('clients_updated', clients);

        res.json({ 
            success: true, 
            clients: clients, 
            count: clients.length,
            message: `تم معالجة ${clients.length} عميل بنجاح`
        });

    } catch (error) {
        console.error('❌ Error processing Excel:', error);
        
        // Clean up uploaded file
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(500).json({ 
            error: 'فشل معالجة ملف Excel: ' + error.message 
        });
    }
});

// Get clients list
app.get('/api/clients', authenticateUser, (req, res) => {
    try {
        if (fs.existsSync('./memory/clients.json')) {
            const clientsData = fs.readFileSync('./memory/clients.json', 'utf8');
            const clients = JSON.parse(clientsData);
            res.json({ success: true, clients: clients });
        } else {
            res.json({ success: true, clients: [] });
        }
    } catch (error) {
        res.json({ success: true, clients: [] });
    }
});

// Get client messages
app.get('/api/client-messages/:phone', authenticateUser, (req, res) => {
    try {
        const phone = req.params.phone;
        const messages = getClientMessages(phone);
        res.json({ success: true, messages: messages });
    } catch (error) {
        res.json({ success: true, messages: [] });
    }
});

// Get employee performance data
app.get('/api/employee-performance', authenticateUser, (req, res) => {
    try {
        const userId = req.user.id;
        
        if (!employeePerformance[userId]) {
            initializeUserPerformance(userId);
        }
        
        const performanceData = {
            ...employeePerformance[userId],
            clientInteractions: Array.from(employeePerformance[userId].clientInteractions.entries()),
            report: generateUserPerformanceReport(userId)
        };
        res.json({ success: true, performance: performanceData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send report to manager
app.post('/api/send-to-manager', authenticateUser, async (req, res) => {
    try {
        console.log('🔄 Sending report to manager...');
        await sendReportToManager(req.user.id);
        res.json({ 
            success: true, 
            message: 'تم إرسال التقرير إلى المدير بنجاح'
        });
    } catch (error) {
        console.error('❌ Error sending report to manager:', error);
        res.status(500).json({ 
            success: false, 
            error: 'فشل إرسال التقرير: ' + error.message 
        });
    }
});

// Export report
app.get('/api/export-report', authenticateUser, (req, res) => {
    try {
        console.log('🔄 Exporting report...');
        const result = exportReportToFile(req.user.id);
        
        // Send the file for download
        res.download(result.filePath, result.fileName, (err) => {
            if (err) {
                console.error('Error downloading file:', err);
                res.status(500).json({ 
                    success: false, 
                    error: 'فشل تحميل التقرير' 
                });
            }
        });
        
    } catch (error) {
        console.error('❌ Error exporting report:', error);
        res.status(500).json({ 
            success: false, 
            error: 'فشل تصدير التقرير: ' + error.message 
        });
    }
});

// Bulk send endpoint
app.post('/api/send-bulk', authenticateUser, async (req, res) => {
    try {
        const { message, delay = 40, clients } = req.body;
        
        console.log('📤 Bulk send request received for', clients?.length, 'clients by user', req.user.name);

        const userId = req.user.id;
        const userSession = getUserWhatsAppSession(userId);
        
        if (!userSession || !userSession.isConnected) {
            return res.status(400).json({ 
                success: false, 
                error: 'واتساب غير متصل' 
            });
        }

        if (!message || !clients || clients.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'الرسالة وقائمة العملاء مطلوبة' 
            });
        }

        let successCount = 0;
        let failCount = 0;
        
        // Track bulk campaign for the user
        trackEmployeeActivity(userId, 'bulk_campaign', { 
            clientCount: clients.length,
            message: message.substring(0, 50) 
        });
        
        io.emit('bulk_progress', {
            type: 'start',
            total: clients.length,
            message: `بدأ الإرسال إلى ${clients.length} عميل`
        });

        for (let i = 0; i < clients.length; i++) {
            const client = clients[i];
            
            if (!client.phone || client.phone.length < 10) {
                failCount++;
                continue;
            }

            const formattedPhone = formatPhoneNumber(client.phone);
            const phoneNumber = formattedPhone + '@c.us';
            
            try {
                // Wait between messages (except first one)
                if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, delay * 1000));
                }
                
                await userSession.client.sendMessage(phoneNumber, message);
                
                successCount++;
                
                client.lastMessage = message.substring(0, 50) + (message.length > 50 ? '...' : '');
                client.lastSent = new Date().toISOString();
                
                // Track message sent for the user
                trackEmployeeActivity(userId, 'message_sent', { 
                    clientPhone: formattedPhone,
                    clientName: client.name,
                    message: message.substring(0, 30) 
                });
                
                io.emit('bulk_progress', {
                    success: true,
                    client: client.name,
                    clientPhone: client.phone,
                    message: message.substring(0, 30) + '...',
                    current: i + 1,
                    total: clients.length
                });

                storeClientMessage(client.phone, message, true);
                
                console.log(`✅ User ${userId} sent to ${client.name}: ${client.phone} (${i + 1}/${clients.length})`);
                
            } catch (error) {
                failCount++;
                
                io.emit('bulk_progress', {
                    success: false,
                    client: client.name,
                    clientPhone: client.phone,
                    error: error.message,
                    current: i + 1,
                    total: clients.length
                });
                
                console.error(`❌ User ${userId} failed to send to ${client.name}:`, error.message);
            }
        }

        res.json({ 
            success: true, 
            message: `تم إرسال ${successCount} رسالة بنجاح وفشل ${failCount}`
        });

        console.log(`🎉 User ${userId} bulk send completed: ${successCount} successful, ${failCount} failed`);

    } catch (error) {
        console.error('❌ Error in bulk send:', error);
        res.status(500).json({ 
            success: false, 
            error: 'فشل الإرسال الجماعي: ' + error.message 
        });
    }
});

// Send individual message
app.post('/api/send-message', authenticateUser, async (req, res) => {
    try {
        const { phone, message } = req.body;
        
        const userId = req.user.id;
        const userSession = getUserWhatsAppSession(userId);
        
        if (!userSession || !userSession.isConnected) {
            return res.status(400).json({ error: 'واتساب غير متصل' });
        }

        if (!phone || !message) {
            return res.status(400).json({ error: 'رقم الهاتف والرسالة مطلوبان' });
        }

        const formattedPhone = formatPhoneNumber(phone);
        const phoneNumber = formattedPhone + '@c.us';
        
        await userSession.client.sendMessage(phoneNumber, message);
        
        // Track individual message for the user
        trackEmployeeActivity(userId, 'message_sent', { 
            clientPhone: formattedPhone,
            message: message.substring(0, 30) 
        });
        
        storeClientMessage(phone, message, true);
        updateClientLastMessage(phone, message);
        
        res.json({ 
            success: true, 
            message: 'تم إرسال الرسالة بنجاح'
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'فشل إرسال الرسالة: ' + error.message });
    }
});

// Socket.io
io.on('connection', (socket) => {
    console.log('Client connected');
    
    // Handle user authentication for socket
    socket.on('authenticate', (token) => {
        try {
            const decoded = verifyToken(token);
            if (!decoded) {
                socket.emit('auth_error', { error: 'Token غير صالح' });
                return;
            }
            
            const user = users.find(u => u.id === decoded.userId && u.isActive);
            if (!user) {
                socket.emit('auth_error', { error: 'المستخدم غير موجود' });
                return;
            }
            
            socket.userId = user.id;
            console.log(`🔐 Socket authenticated for user ${user.name}`);
            
            // 🆕 CRITICAL: Send authentication success
            socket.emit('authenticated', { 
                userId: user.id, 
                username: user.username 
            });
            
            // Send user-specific initial data
            const userSession = getUserWhatsAppSession(user.id);
            if (userSession) {
                socket.emit(`user_status_${user.id}`, { 
                    connected: userSession.isConnected, 
                    message: userSession.isConnected ? 'واتساب متصل ✅' : 
                            userSession.status === 'qr-ready' ? 'يرجى مسح QR Code' :
                            'جارٍ الاتصال...',
                    status: userSession.status,
                    hasQr: !!userSession.qrCode,
                    userId: user.id
                });
                
                // 🆕 CRITICAL: If QR code already exists, send it immediately
                if (userSession.qrCode) {
                    console.log(`📱 Sending existing QR code to user ${user.id}`);
                    socket.emit(`user_qr_${user.id}`, { 
                        qrCode: userSession.qrCode,
                        userId: user.id,
                        timestamp: new Date().toISOString()
                    });
                }
            }
            
        } catch (error) {
            socket.emit('auth_error', { error: 'خطأ في المصادقة' });
        }
    });
    
    // Handle user-specific bot toggle
    socket.on('user_toggle_bot', (data) => {
        if (!socket.userId) {
            socket.emit('error', { error: 'غير مصرح' });
            return;
        }
        
        const success = toggleUserBot(socket.userId, data.stop);
        if (success) {
            io.emit(`user_bot_status_${socket.userId}`, { 
                stopped: data.stop,
                userId: socket.userId 
            });
        }
    });

    // Handle client status update
    socket.on('update_client_status', (data) => {
        updateClientStatus(data.phone, data.status);
        socket.emit('client_status_updated', { success: true });
    });

    socket.on('send_message', async (data) => {
        if (!socket.userId) {
            socket.emit('message_error', { 
                to: data.to, 
                error: 'غير مصرح' 
            });
            return;
        }
        
        try {
            const { to, message } = data;
            
            const userSession = getUserWhatsAppSession(socket.userId);
            if (!userSession || !userSession.isConnected) {
                socket.emit('message_error', { 
                    to: to, 
                    error: 'واتساب غير متصل' 
                });
                return;
            }

            if (!to || !message) {
                socket.emit('message_error', { 
                    to: to, 
                    error: 'رقم الهاتف والرسالة مطلوبان' 
                });
                return;
            }

            const formattedPhone = formatPhoneNumber(to);
            const phoneNumber = formattedPhone + '@c.us';
            
            await userSession.client.sendMessage(phoneNumber, message);
            
            // Track individual message for the user
            trackEmployeeActivity(socket.userId, 'message_sent', { 
                clientPhone: formattedPhone,
                message: message.substring(0, 30) 
            });
            
            storeClientMessage(to, message, true);
            updateClientLastMessage(to, message);
            
            socket.emit('message_sent', { 
                to: to,
                message: 'تم الإرسال بنجاح'
            });
            
        } catch (error) {
            console.error(`Failed to send message to ${data.to}:`, error);
            socket.emit('message_error', { 
                to: data.to, 
                error: error.message 
            });
        }
    });

    socket.on('user_reconnect_whatsapp', () => {
        if (!socket.userId) {
            socket.emit('error', { error: 'غير مصرح' });
            return;
        }
        
        manualReconnectUserWhatsApp(socket.userId);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Initialize users and performance data
initializeUsers();

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log('🏢 Company:', ragmcloudCompanyInfo.name);
    console.log('📞 Phone:', ragmcloudCompanyInfo.phone);
    console.log('🌐 Website:', ragmcloudCompanyInfo.website);
    console.log('🔑 DeepSeek Available:', deepseekAvailable);
    console.log('👥 User Management: ENABLED');
    console.log('🔐 Authentication: JWT + Bcrypt');
    console.log('🆕 MULTI-USER WHATSAPP: ENABLED');
    console.log('🤖 BOT STATUS: READY');
    console.log('⏰ AUTO-REPLY DELAY: 3 SECONDS');
    console.log('🎯 AI AUTO-STATUS DETECTION: ENABLED');
    console.log('📊 AUTO-REPORT AFTER 30 MESSAGES: ENABLED');
    console.log('💰 CORRECT PACKAGES: 1000, 1800, 2700, 3000 ريال');
    console.log('🎉 MULTI-USER ARCHITECTURE: COMPLETED');
    console.log('☁️  CLOUD-OPTIMIZED WHATSAPP: ENABLED');
    console.log('📱 QR CODE FIXED: FRONTEND WILL NOW RECEIVE QR CODES');
    console.log('🆕 ENHANCEMENTS COMPLETED:');
    console.log('   ✅ Manual Client Status Assignment - FIXED');
    console.log('   ✅ Real User Identity in AI Responses - FIXED');
    console.log('   ✅ Enhanced User Management - FIXED');
    console.log('   ✅ AI Training Portal - FIXED');
    console.log('   ✅ GLOBAL AI Training - Admin changes affect ALL users');
    console.log('   ✅ PERMANENT AI Storage - Training survives server restarts');
    console.log('   ✅ REAL-TIME Updates - Changes apply immediately');
});
