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
const winston = require('winston');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const Bull = require('bull');
const helmet = require('helmet');

// Load environment variables
require('dotenv').config();

// =============================================
// CONFIGURATION & VALIDATION
// =============================================

// Validate required environment variables
const requiredEnvVars = ['JWT_SECRET', 'DEEPSEEK_API_KEY'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingVars.join(', '));
    console.error('Please create a .env file with all required variables');
    process.exit(1);
}

// Configuration object
const config = {
    port: process.env.PORT || 10000,
    jwtSecret: process.env.JWT_SECRET,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    managerPhone: process.env.MANAGER_PHONE || '966531304279',
    mongoUri: process.env.MONGODB_URI,
    sessionPath: process.env.SESSION_PATH || './sessions',
    reportsPath: process.env.REPORTS_PATH || './reports',
    maxRetries: parseInt(process.env.MAX_RETRIES || '5'),
    retryDelay: parseInt(process.env.RETRY_DELAY || '15000'),
    bulkMessageDelay: parseInt(process.env.BULK_MESSAGE_DELAY || '40'),
    autoReplyDelay: parseInt(process.env.AUTO_REPLY_DELAY || '3000'),
    nodeEnv: process.env.NODE_ENV || 'development',
    puppeteerPath: process.env.PUPPETEER_EXECUTABLE_PATH || null
};

// =============================================
// LOGGING SETUP
// =============================================

const logger = winston.createLogger({
    level: config.nodeEnv === 'production' ? 'info' : 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'ragmcloud-whatsapp' },
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
    ]
});

if (config.nodeEnv !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

// =============================================
// EXPRESS APP SETUP
// =============================================

const app = express();
const server = http.createServer(app);

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false, // Allow inline scripts for now
    crossOriginEmbedderPolicy: false
}));

// CORS configuration for Socket.io
const io = socketIo(server, {
    cors: {
        origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many login attempts, please try again later.'
});

// Apply rate limiting
app.use('/api/', limiter);
app.use('/api/login', strictLimiter);

// CORS middleware
app.use((req, res, next) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS ? 
        process.env.ALLOWED_ORIGINS.split(',') : ['*'];
    const origin = req.headers.origin;
    
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin || '*');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Create required directories
const directories = ['uploads', 'memory', 'tmp', 'reports', 'sessions', 'data', 'logs'];
directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Configure multer for file uploads with size limits
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'));
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max file size
        files: 1
    },
    fileFilter: (req, file, cb) => {
        // Allow only Excel files
        const allowedMimes = [
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/csv'
        ];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only Excel and CSV files are allowed.'));
        }
    }
});

// =============================================
// MESSAGE QUEUE SETUP
// =============================================

let messageQueue;
try {
    if (process.env.REDIS_URL) {
        messageQueue = new Bull('message-queue', process.env.REDIS_URL);
        
        messageQueue.process(5, async (job) => {
            const { userId, phone, message, retryCount = 0 } = job.data;
            try {
                await sendWhatsAppMessage(userId, phone, message);
                return { success: true, phone, message: 'Message sent successfully' };
            } catch (error) {
                if (retryCount < 3) {
                    throw error; // Bull will retry
                }
                logger.error('Message send failed after retries', { userId, phone, error: error.message });
                return { success: false, phone, error: error.message };
            }
        });
        
        logger.info('Message queue initialized with Redis');
    }
} catch (error) {
    logger.warn('Message queue not initialized (Redis not configured)', error);
}

// =============================================
// MULTI-USER WHATSAPP ARCHITECTURE
// =============================================

// User WhatsApp Sessions Management with cleanup tracking
const userWhatsAppSessions = new Map();
const sessionRetryCount = new Map();
const sessionLastActivity = new Map();

// Session object structure:
// {
//   client: null,
//   qrCode: null,
//   status: 'disconnected',
//   isConnected: false,
//   isBotStopped: false,
//   clientReplyTimers: new Map(),
//   importedClients: new Set(),
//   createdAt: Date,
//   lastActivity: Date
// }

// User Management Variables
let users = [];
let currentSessions = new Map();

// Employee Performance Tracking - PER USER
let employeePerformance = {};

// DeepSeek AI Configuration
let deepseekAvailable = false;

logger.info('Initializing DeepSeek AI...');
if (config.deepseekApiKey) {
    deepseekAvailable = true;
    logger.info('DeepSeek API key found');
} else {
    logger.warn('DeepSeek API key not found in .env file');
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

    services: {
        accounting: "الحلول المحاسبية المتكاملة",
        inventory: "إدارة المخزون والمستودعات",
        hr: "إدارة الموارد البشرية والرواتب",
        crm: "إدارة علاقات العملاء",
        sales: "إدارة المبيعات والمشتريات", 
        reports: "التقارير والتحليلات الذكية",
        integration: "التكامل مع الأنظمة الحكومية"
    },

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

// AI System Prompt
const AI_SYSTEM_PROMPT = `أنت مساعد ذكي ومحترف تمثل شركة "رقم كلاود" المتخصصة في أنظمة ERP السحابية. أنت بائع مقنع ومحاسب خبير.

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

تذكر: أنت بائع محترف هدفك مساعدة العملاء في اختيار النظام المناسب لشركاتهم.`;

// =============================================
// CLEANUP & MAINTENANCE FUNCTIONS
// =============================================

// Cleanup inactive sessions
function cleanupInactiveSessions() {
    try {
        const now = Date.now();
        const maxInactiveTime = 3600000; // 1 hour
        
        for (const [userId, session] of userWhatsAppSessions) {
            const lastActivity = sessionLastActivity.get(userId) || now;
            const inactiveTime = now - lastActivity;
            
            if (!session.isConnected && inactiveTime > maxInactiveTime) {
                logger.info(`Cleaning up inactive session for user ${userId}`);
                
                if (session.client) {
                    session.client.destroy().catch(err => 
                        logger.error(`Error destroying client for user ${userId}:`, err)
                    );
                }
                
                userWhatsAppSessions.delete(userId);
                sessionLastActivity.delete(userId);
                sessionRetryCount.delete(userId);
            }
        }
    } catch (error) {
        logger.error('Error in cleanup inactive sessions:', error);
    }
}

// Run cleanup every 10 minutes
setInterval(cleanupInactiveSessions, 600000);

// Clean old log files
function cleanOldLogs() {
    try {
        const logsDir = path.join(__dirname, 'logs');
        const files = fs.readdirSync(logsDir);
        const now = Date.now();
        const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
        
        files.forEach(file => {
            const filePath = path.join(logsDir, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtime.getTime() > maxAge) {
                fs.unlinkSync(filePath);
                logger.info(`Deleted old log file: ${file}`);
            }
        });
    } catch (error) {
        logger.error('Error cleaning old logs:', error);
    }
}

// Run log cleanup daily
setInterval(cleanOldLogs, 24 * 60 * 60 * 1000);

// =============================================
// MULTI-USER WHATSAPP FUNCTIONS (IMPROVED)
// =============================================

async function initializeUserWhatsApp(userId, retryCount = 0) {
    logger.info(`Starting WhatsApp for user ${userId}, attempt ${retryCount + 1}`);
    
    try {
        // Check if user already has an active session
        if (userWhatsAppSessions.has(userId)) {
            const existingSession = userWhatsAppSessions.get(userId);
            if (existingSession.status === 'connected') {
                logger.info(`User ${userId} already has an active WhatsApp session`);
                return existingSession;
            }
        }

        // Check retry count
        if (retryCount >= config.maxRetries) {
            logger.error(`Max retries (${config.maxRetries}) reached for user ${userId}`);
            io.emit(`user_status_${userId}`, {
                connected: false,
                message: 'فشل الاتصال بعد محاولات متعددة',
                status: 'max-retries-reached',
                hasQr: false,
                userId: userId
            });
            return null;
        }

        // Initialize a new session object
        const userSession = {
            client: null,
            qrCode: null,
            status: 'disconnected',
            isConnected: false,
            isBotStopped: false,
            clientReplyTimers: new Map(),
            importedClients: new Set(),
            createdAt: new Date(),
            lastActivity: new Date()
        };
        
        userWhatsAppSessions.set(userId, userSession);
        sessionLastActivity.set(userId, Date.now());
        sessionRetryCount.set(userId, retryCount);

        // WhatsApp Client Configuration with better error handling
        const clientConfig = {
            authStrategy: new LocalAuth({ 
                clientId: `ragmcloud-user-${userId}`,
                dataPath: path.join(config.sessionPath, `user-${userId}`)
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
                    '--single-process',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--disable-ipc-flooding-protection'
                ],
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null
            },
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
            }
        };

        if (config.puppeteerPath) {
            clientConfig.puppeteer.executablePath = config.puppeteerPath;
        }

        userSession.client = new Client(clientConfig);

        // QR Code Generation
        userSession.client.on('qr', (qr) => {
            logger.info(`QR CODE RECEIVED for user ${userId}`);
            qrcode.generate(qr, { small: true });
            
            QRCode.toDataURL(qr, (err, url) => {
                if (!err) {
                    userSession.qrCode = url;
                    userSession.status = 'qr-ready';
                    sessionLastActivity.set(userId, Date.now());
                    
                    logger.info(`QR code generated for user ${userId}`);
                    
                    io.emit(`user_qr_${userId}`, { 
                        qrCode: url,
                        userId: userId,
                        timestamp: new Date().toISOString()
                    });
                    
                    io.emit(`user_status_${userId}`, { 
                        connected: false, 
                        message: 'يرجى مسح QR Code للاتصال',
                        status: 'qr-ready',
                        hasQr: true,
                        userId: userId
                    });
                } else {
                    logger.error(`QR code generation failed for user ${userId}:`, err);
                    
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

        // Ready Event
        userSession.client.on('ready', () => {
            logger.info(`WhatsApp READY for user ${userId}!`);
            userSession.isConnected = true;
            userSession.status = 'connected';
            sessionLastActivity.set(userId, Date.now());
            sessionRetryCount.set(userId, 0); // Reset retry count on success
            
            io.emit(`user_status_${userId}`, { 
                connected: true, 
                message: 'واتساب متصل ✅',
                status: 'connected',
                hasQr: false,
                userId: userId
            });
        });

        // Message Event
        userSession.client.on('message', async (message) => {
            if (message.from === 'status@broadcast' || message.fromMe) {
                return;
            }

            sessionLastActivity.set(userId, Date.now());
            
            logger.debug(`User ${userId} received message from: ${message.from}`);
            
            try {
                const clientPhone = message.from.replace('@c.us', '');
                storeClientMessage(clientPhone, message.body, false);
                
                io.emit(`user_message_${userId}`, {
                    from: clientPhone,
                    message: message.body,
                    timestamp: new Date(),
                    fromMe: false,
                    userId: userId
                });

                updateClientLastMessage(clientPhone, message.body);

                await processUserIncomingMessage(userId, message.body, message.from);
                
            } catch (error) {
                logger.error(`Error handling message for user ${userId}:`, error);
            }
        });

        // Authentication Failure
        userSession.client.on('auth_failure', (msg) => {
            logger.error(`WhatsApp auth failed for user ${userId}:`, msg);
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

        // Disconnected Event
        userSession.client.on('disconnected', (reason) => {
            logger.warn(`WhatsApp disconnected for user ${userId}: ${reason}`);
            userSession.isConnected = false;
            userSession.status = 'disconnected';
            
            io.emit(`user_status_${userId}`, { 
                connected: false, 
                message: 'جارٍ إعادة الاتصال...',
                status: 'disconnected',
                hasQr: false,
                userId: userId
            });
            
            // Auto-reconnect with exponential backoff
            const nextRetryCount = (sessionRetryCount.get(userId) || 0) + 1;
            const delay = Math.min(config.retryDelay * Math.pow(2, nextRetryCount), 300000);
            
            setTimeout(() => {
                initializeUserWhatsApp(userId, nextRetryCount);
            }, delay);
        });

        // Error handling
        userSession.client.on('error', (error) => {
            logger.error(`WhatsApp error for user ${userId}:`, error);
        });

        // Initialize the client
        await userSession.client.initialize();
        
        return userSession;
        
    } catch (error) {
        logger.error(`Error creating WhatsApp client for user ${userId}:`, error);
        
        // Retry with exponential backoff
        const nextRetryCount = retryCount + 1;
        const delay = Math.min(config.retryDelay * Math.pow(2, nextRetryCount), 300000);
        
        setTimeout(() => {
            initializeUserWhatsApp(userId, nextRetryCount);
        }, delay);
        
        return null;
    }
}

// Get User WhatsApp Session
function getUserWhatsAppSession(userId) {
    const session = userWhatsAppSessions.get(userId);
    if (session) {
        sessionLastActivity.set(userId, Date.now());
    }
    return session;
}

// Check if User WhatsApp is Connected
function isUserWhatsAppConnected(userId) {
    const session = getUserWhatsAppSession(userId);
    return session && session.isConnected;
}

// Send WhatsApp Message (for queue)
async function sendWhatsAppMessage(userId, phone, message) {
    const userSession = getUserWhatsAppSession(userId);
    
    if (!userSession || !userSession.isConnected) {
        throw new Error('WhatsApp not connected');
    }
    
    const formattedPhone = formatPhoneNumber(phone);
    const phoneNumber = formattedPhone + '@c.us';
    
    await userSession.client.sendMessage(phoneNumber, message);
    
    trackEmployeeActivity(userId, 'message_sent', { 
        clientPhone: formattedPhone,
        message: message.substring(0, 30) 
    });
    
    storeClientMessage(phone, message, true);
    updateClientLastMessage(phone, message);
}

// Process incoming messages
async function processUserIncomingMessage(userId, message, from) {
    try {
        const clientPhone = from.replace('@c.us', '');
        
        storeClientMessage(clientPhone, message, false);
        autoDetectClientInterest(clientPhone, message);
        
        const userSession = getUserWhatsAppSession(userId);
        if (!userSession) {
            logger.error(`No WhatsApp session found for user ${userId}`);
            return;
        }
        
        if (userSession.isBotStopped) {
            logger.debug(`Bot is stopped for user ${userId} - no auto-reply`);
            return;
        }
        
        if (!shouldReplyToClient(userId, clientPhone)) {
            logger.debug(`Client not in user ${userId}'s imported list - skipping auto-reply`);
            return;
        }
        
        if (!shouldUserAutoReplyNow(userId, clientPhone)) {
            logger.debug(`User ${userId} waiting for delay before next reply`);
            return;
        }
        
        let aiResponse;
        try {
            aiResponse = await Promise.race([
                generateRagmcloudAIResponse(message, clientPhone),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('AI response timeout')), 15000)
                )
            ]);
        } catch (aiError) {
            logger.error(`AI response error for user ${userId}:`, aiError);
            aiResponse = generateEnhancedRagmcloudResponse(message, clientPhone);
        }
        
        await userSession.client.sendMessage(from, aiResponse);
        
        storeClientMessage(clientPhone, aiResponse, true);
        updateUserReplyTimer(userId, clientPhone);
        
        if (currentSessions.has(userId)) {
            trackEmployeeActivity(userId, 'ai_reply', { clientPhone: clientPhone });
        }
        
        updateClientLastMessage(clientPhone, aiResponse);
        
        io.emit(`user_message_${userId}`, {
            from: clientPhone,
            message: aiResponse,
            timestamp: new Date(),
            fromMe: true,
            userId: userId
        });
        
        logger.info(`User ${userId} auto-reply sent to ${clientPhone}`);
        
    } catch (error) {
        logger.error(`Error processing incoming message for user ${userId}:`, error);
        
        try {
            const userSession = getUserWhatsAppSession(userId);
            if (userSession && userSession.isConnected) {
                const professionalMessage = "عذراً، يبدو أن هناك تأخير في النظام. يرجى المحاولة مرة أخرى أو التواصل معنا مباشرة على +966555111222";
                await userSession.client.sendMessage(from, professionalMessage);
            }
        } catch (sendError) {
            logger.error(`User ${userId} failed to send error message:`, sendError);
        }
    }
}

// User-specific Auto-Reply Functions
function shouldReplyToClient(userId, phone) {
    const userSession = getUserWhatsAppSession(userId);
    if (!userSession) return false;
    return userSession.importedClients.has(phone);
}

function shouldUserAutoReplyNow(userId, phone) {
    const userSession = getUserWhatsAppSession(userId);
    if (!userSession) return true;
    
    const lastReplyTime = userSession.clientReplyTimers.get(phone);
    if (!lastReplyTime) return true;
    
    const timeDiff = Date.now() - lastReplyTime;
    return timeDiff >= config.autoReplyDelay;
}

function updateUserReplyTimer(userId, phone) {
    const userSession = getUserWhatsAppSession(userId);
    if (userSession) {
        userSession.clientReplyTimers.set(phone, Date.now());
    }
}

// User-specific Bot Control
function toggleUserBot(userId, stop) {
    const userSession = getUserWhatsAppSession(userId);
    if (userSession) {
        userSession.isBotStopped = stop;
        logger.info(`User ${userId} bot ${stop ? 'stopped' : 'started'}`);
        io.emit(`user_bot_status_${userId}`, { stopped: stop, userId: userId });
        return true;
    }
    return false;
}

// User-specific WhatsApp Reconnection
async function manualReconnectUserWhatsApp(userId) {
    logger.info(`Manual reconnection requested for user ${userId}...`);
    const userSession = getUserWhatsAppSession(userId);
    
    if (userSession && userSession.client) {
        await userSession.client.destroy();
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    return initializeUserWhatsApp(userId);
}

// WhatsApp Disconnect Function
async function disconnectUserWhatsApp(userId) {
    logger.info(`Disconnecting WhatsApp for user ${userId}...`);
    const userSession = getUserWhatsAppSession(userId);
    
    if (userSession && userSession.client) {
        try {
            await userSession.client.destroy();
            userSession.isConnected = false;
            userSession.status = 'disconnected';
            userSession.qrCode = null;
            
            io.emit(`user_status_${userId}`, { 
                connected: false, 
                message: 'تم فصل الواتساب',
                status: 'disconnected',
                hasQr: false,
                userId: userId
            });
            
            logger.info(`WhatsApp disconnected for user ${userId}`);
        } catch (error) {
            logger.error(`Error disconnecting WhatsApp for user ${userId}:`, error);
            throw error;
        }
    }
}

// =============================================
// USER MANAGEMENT FUNCTIONS
// =============================================

function initializeUsers() {
    const usersFile = './data/users.json';
    
    try {
        if (fs.existsSync(usersFile)) {
            const usersData = fs.readFileSync(usersFile, 'utf8');
            users = JSON.parse(usersData);
            logger.info(`Loaded ${users.length} users from file`);
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
                }
            ];
            saveUsers();
            logger.info('Created default admin user');
        }
    } catch (error) {
        logger.error('Error initializing users:', error);
        users = [];
    }
}

function saveUsers() {
    try {
        const usersFile = './data/users.json';
        fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
    } catch (error) {
        logger.error('Error saving users:', error);
    }
}

function generateToken(user) {
    return jwt.sign(
        { 
            userId: user.id, 
            username: user.username,
            role: user.role 
        },
        config.jwtSecret,
        { expiresIn: '24h' }
    );
}

function verifyToken(token) {
    try {
        return jwt.verify(token, config.jwtSecret);
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

// =============================================
// PERFORMANCE TRACKING FUNCTIONS
// =============================================

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
    
    // Keep only last 1000 messages in history
    if (userPerf.messageHistory.length > 1000) {
        userPerf.messageHistory = userPerf.messageHistory.slice(-1000);
    }
    
    checkAutoSendReport(userId);
    saveUserPerformanceData(userId);
}

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
        logger.error('Error saving performance data for user', userId, error);
    }
}

function loadUserPerformanceData(userId) {
    try {
        const filePath = `./memory/employee_performance_${userId}.json`;
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            employeePerformance[userId] = {
                ...data,
                clientInteractions: new Map(data.clientInteractions || [])
            };
            
            const today = new Date().toISOString().split('T')[0];
            if (employeePerformance[userId].dailyStats.date !== today) {
                resetUserDailyStats(userId);
            }
        } else {
            initializeUserPerformance(userId);
        }
    } catch (error) {
        logger.error('Error loading performance data for user', userId, error);
        initializeUserPerformance(userId);
    }
}

function generateUserPerformanceReport(userId) {
    if (!employeePerformance[userId]) {
        initializeUserPerformance(userId);
    }
    
    const stats = employeePerformance[userId].dailyStats;
    const totalInteractions = stats.messagesSent + stats.aiRepliesSent;
    const interestRate = stats.clientsContacted > 0 ? (stats.interestedClients / stats.clientsContacted * 100).toFixed(1) : 0;
    
    let performanceScore = 0;
    performanceScore += Math.min(stats.messagesSent * 2, 30);
    performanceScore += Math.min(stats.clientsContacted * 5, 30);
    performanceScore += Math.min(stats.interestedClients * 10, 40);
    
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
    
    if (stats.messagesSent < 10) {
        improvementSuggestions.push('• زيادة عدد الرسائل المرسلة');
    }
    if (stats.clientsContacted < 5) {
        improvementSuggestions.push('• التواصل مع المزيد من العملاء');
    }
    if (stats.interestedClients < 2) {
        improvementSuggestions.push('• تحسين جودة المحادثات لجذب عملاء مهتمين');
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

💡 **اقتراحات للتحسين:**
${improvementSuggestions.join('\n')}

⏰ **نشاط اليوم:**
• بدء العمل: ${new Date(stats.startTime).toLocaleTimeString('ar-SA')}
• آخر نشاط: ${new Date(stats.lastActivity).toLocaleTimeString('ar-SA')}
• المدة النشطة: ${calculateActiveHours(stats.startTime, stats.lastActivity)}
    `.trim();
    
    return report;
}

function checkAutoSendReport(userId) {
    if (!employeePerformance[userId]) return;
    
    const messageCount = employeePerformance[userId].dailyStats.messagesSent;
    
    if (messageCount > 0 && messageCount % 30 === 0) {
        logger.info(`Auto-sending report for user ${userId} after ${messageCount} messages...`);
        
        io.emit('auto_report_notification', {
            userId: userId,
            messageCount: messageCount,
            message: `تم إرسال ${messageCount} رسالة. جاري إرسال التقرير التلقائي إلى المدير...`
        });
        
        setTimeout(() => {
            sendReportToManager(userId).catch(error => {
                logger.error('Auto-report failed for user', userId, error);
            });
        }, 3000);
    }
}

// =============================================
// AI & MESSAGE PROCESSING FUNCTIONS
// =============================================

function shouldSendGreeting(phone) {
    try {
        const messages = getClientMessages(phone);
        if (messages.length === 0) {
            return true;
        }
        
        const lastMessage = messages[messages.length - 1];
        const lastMessageTime = new Date(lastMessage.timestamp);
        const currentTime = new Date();
        const hoursDiff = (currentTime - lastMessageTime) / (1000 * 60 * 60);
        
        return hoursDiff > 5;
    } catch (error) {
        logger.error('Error checking greeting condition:', error);
        return true;
    }
}

function autoDetectClientInterest(phone, message) {
    try {
        const msg = message.toLowerCase();
        
        const interestedKeywords = ['سعر', 'تكلفة', 'عرض', 'خصم', 'تجربة', 'جرب', 'مميزات', 'تفاصيل'];
        const busyKeywords = ['لاحقاً', 'مشغول', 'بعدين', 'لاحقا', 'الوقت', 'منشغل'];
        const notInterestedKeywords = ['لا أريد', 'غير مهتم', 'لا أرغب', 'شكراً', 'لا شكر'];
        
        let newStatus = 'no-reply';
        
        if (interestedKeywords.some(keyword => msg.includes(keyword))) {
            newStatus = 'interested';
        } else if (busyKeywords.some(keyword => msg.includes(keyword))) {
            newStatus = 'busy';
        } else if (notInterestedKeywords.some(keyword => msg.includes(keyword))) {
            newStatus = 'not-interested';
        }
        
        updateClientStatus(phone, newStatus);
        
        return newStatus;
    } catch (error) {
        logger.error('Error auto-detecting client interest:', error);
        return 'no-reply';
    }
}

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
            
            io.emit('client_status_updated', {
                phone: phone,
                status: status,
                clients: clients
            });
            
            logger.info(`Auto-updated client ${phone} status to: ${status}`);
        }
    } catch (error) {
        logger.error('Error updating client status:', error);
    }
}

function getConversationHistoryForAI(phone, maxMessages = 10) {
    try {
        const messages = getClientMessages(phone);
        const recentMessages = messages.slice(-maxMessages);
        
        const conversationHistory = recentMessages.map(msg => {
            const role = msg.fromMe ? 'assistant' : 'user';
            return {
                role: role,
                content: msg.message
            };
        });
        
        logger.debug(`Loaded ${conversationHistory.length} previous messages for context`);
        return conversationHistory;
    } catch (error) {
        logger.error('Error getting conversation history:', error);
        return [];
    }
}

async function callDeepSeekAI(userMessage, clientPhone) {
    if (!deepseekAvailable || !config.deepseekApiKey) {
        throw new Error('DeepSeek not available');
    }

    try {
        logger.debug('Calling DeepSeek API...');
        
        const shouldGreet = shouldSendGreeting(clientPhone);
        const conversationHistory = getConversationHistoryForAI(clientPhone);
        
        const messages = [
            {
                role: "system",
                content: AI_SYSTEM_PROMPT
            }
        ];

        if (conversationHistory.length > 0) {
            messages.push(...conversationHistory);
        }

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
                'Authorization': `Bearer ${config.deepseekApiKey}`
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
        logger.error('DeepSeek API Error:', error);
        throw error;
    }
}

function generateEnhancedRagmcloudResponse(userMessage, clientPhone) {
    const msg = userMessage.toLowerCase().trim();
    const shouldGreet = shouldSendGreeting(clientPhone);
    
    // Check for irrelevant questions
    const irrelevantQuestions = [
        'من أنت', 'ما اسمك', 'who are you', 'what is your name',
        'مدير', 'المدير', 'manager', 'owner', 'صاحب'
    ];
    
    if (irrelevantQuestions.some(q => msg.includes(q))) {
        return "أعتذر، هذا السؤال خارج نطاق تخصصي في أنظمة ERP. يمكنني مساعدتك في اختيار النظام المناسب لشركتك.";
    }
    
    // Return appropriate response based on message content
    if (shouldGreet && (msg.includes('السلام') || msg.includes('مرحبا'))) {
        return `السلام عليكم ورحمة الله وبركاته 🌟\n\nأهلاً بك! أنا مساعدك في نظام رقم كلاود ERP.\n\nكيف يمكنني مساعدتك اليوم؟`;
    }
    
    // Default response
    return `أهلاً بك! أنا مساعد رقم كلاود المتخصص في أنظمة ERP.\n\nيمكنني مساعدتك في اختيار الباقة المناسبة لشركتك.\n\n📞 للاستشارة: +966555111222`;
}

async function generateRagmcloudAIResponse(userMessage, clientPhone) {
    logger.debug('Processing message for Ragmcloud with memory:', userMessage);
    
    if (deepseekAvailable) {
        try {
            const aiResponse = await callDeepSeekAI(userMessage, clientPhone);
            logger.debug('DeepSeek Response successful');
            return aiResponse;
        } catch (error) {
            logger.error('DeepSeek API Error:', error);
            return generateEnhancedRagmcloudResponse(userMessage, clientPhone);
        }
    }
    
    return generateEnhancedRagmcloudResponse(userMessage, clientPhone);
}

// =============================================
// UTILITY FUNCTIONS
// =============================================

function storeClientMessage(phone, message, isFromMe) {
    try {
        const messageData = {
            message: message,
            fromMe: isFromMe,
            timestamp: new Date().toISOString()
        };

        let clientMessages = [];
        const messageFile = `./memory/messages_${phone}.json`;
        
        if (!fs.existsSync('./memory')) {
            fs.mkdirSync('./memory', { recursive: true });
        }
        
        if (fs.existsSync(messageFile)) {
            try {
                const messagesData = fs.readFileSync(messageFile, 'utf8');
                clientMessages = JSON.parse(messagesData);
            } catch (error) {
                logger.error('Error reading message file:', error);
                clientMessages = [];
            }
        }

        clientMessages.push(messageData);
        
        if (clientMessages.length > 50) {
            clientMessages = clientMessages.slice(-50);
        }
        
        fs.writeFileSync(messageFile, JSON.stringify(clientMessages, null, 2));
        
    } catch (error) {
        logger.error('Error storing client message:', error);
    }
}

function getClientMessages(phone) {
    try {
        const messageFile = `./memory/messages_${phone}.json`;
        
        if (fs.existsSync(messageFile)) {
            const messagesData = fs.readFileSync(messageFile, 'utf8');
            return JSON.parse(messagesData);
        }
    } catch (error) {
        logger.error('Error getting client messages:', error);
    }
    
    return [];
}

function formatPhoneNumber(phone) {
    if (!phone) return '';
    let cleaned = phone.toString().replace(/\D/g, '');
    
    if (cleaned.startsWith('0')) {
        cleaned = '966' + cleaned.substring(1);
    } else if (cleaned.startsWith('+966')) {
        cleaned = cleaned.substring(1);
    } else if (cleaned.length === 9) {
        cleaned = '966' + cleaned;
    }
    
    return cleaned;
}

function processExcelFile(filePath) {
    try {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const clients = jsonData.map((row, index) => {
            const name = row['Name'] || row['name'] || row['الاسم'] || 
                         row['اسم العميل'] || `عميل ${index + 1}`;
            
            const phone = formatPhoneNumber(
                row['Phone'] || row['phone'] || row['الهاتف'] || 
                row['رقم الجوال'] || row['جوال']
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
        }).filter(client => client.phone && client.phone.length >= 10);

        logger.info(`Processed ${clients.length} clients from Excel`);
        
        return clients;
    } catch (error) {
        logger.error('Error processing Excel file:', error);
        throw error;
    }
}

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
        logger.error('Error updating client last message:', error);
    }
}

async function sendReportToManager(userId = null) {
    try {
        let report;
        if (userId) {
            report = generateUserPerformanceReport(userId);
        } else {
            report = "📊 **تقرير أداء الفريق الكامل**\n\n";
            currentSessions.forEach((session, uid) => {
                if (session.isActive) {
                    report += generateUserPerformanceReport(uid) + "\n\n" + "=".repeat(50) + "\n\n";
                }
            });
        }
        
        const managerPhone = config.managerPhone + '@c.us';
        
        logger.info('Sending report to manager:', managerPhone);
        
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
        
        logger.info('Report sent to manager successfully');
        return true;
    } catch (error) {
        logger.error('Error sending report to manager:', error);
        throw error;
    }
}

function exportReportToFile(userId = null) {
    try {
        let report, fileName;
        
        if (userId) {
            report = generateUserPerformanceReport(userId);
            const user = users.find(u => u.id === userId);
            fileName = `employee_report_${user ? user.username : 'user'}_${Date.now()}.txt`;
        } else {
            report = "📊 **تقرير أداء الفريق الكامل**\n\n";
            currentSessions.forEach((session, uid) => {
                if (session.isActive) {
                    report += generateUserPerformanceReport(uid) + "\n\n" + "=".repeat(50) + "\n\n";
                }
            });
            fileName = `team_report_${Date.now()}.txt`;
        }
        
        const filePath = path.join(config.reportsPath, fileName);
        
        if (!fs.existsSync(config.reportsPath)) {
            fs.mkdirSync(config.reportsPath, { recursive: true });
        }
        
        fs.writeFileSync(filePath, report, 'utf8');
        
        return {
            success: true,
            fileName: fileName,
            filePath: filePath,
            report: report
        };
    } catch (error) {
        logger.error('Error exporting report:', error);
        throw error;
    }
}

function calculateActiveHours(startTime, endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const diffMs = end - start;
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours} ساعة ${minutes} دقيقة`;
}

// =============================================
// EXPRESS MIDDLEWARE & ROUTES
// =============================================

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// Health check endpoint
app.get('/health', (req, res) => {
    const health = {
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: Date.now(),
        whatsappSessions: userWhatsAppSessions.size,
        activeSessions: Array.from(userWhatsAppSessions.values())
            .filter(s => s.isConnected).length,
        environment: config.nodeEnv
    };
    res.json(health);
});

// Main routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Authentication Routes
app.post('/api/login', 
    body('username').trim().isLength({ min: 3 }).escape(),
    body('password').isLength({ min: 6 }),
    async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const { username, password } = req.body;
        
        const user = users.find(u => u.username === username && u.isActive);
        if (!user) {
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }
        
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }
        
        user.lastLogin = new Date().toISOString();
        saveUsers();
        
        initializeUserPerformance(user.id);
        loadUserPerformanceData(user.id);
        
        // Initialize WhatsApp session asynchronously
        initializeUserWhatsApp(user.id).catch(error => {
            logger.error(`Failed to initialize WhatsApp for user ${user.id}:`, error);
        });
        
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
        logger.error('Login error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

app.post('/api/logout', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.id;
        
        const userSession = getUserWhatsAppSession(userId);
        if (userSession && userSession.client) {
            await userSession.client.destroy();
        }
        userWhatsAppSessions.delete(userId);
        
        currentSessions.delete(userId);
        res.json({ success: true, message: 'تم تسجيل الخروج بنجاح' });
    } catch (error) {
        logger.error('Logout error:', error);
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

// =============================================
// NEW: MISSING API ENDPOINTS - ADDED HERE
// =============================================

// User Management Routes
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
        logger.error('Get users error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Create new user
app.post('/api/users', 
    authenticateUser, 
    authorizeAdmin,
    body('name').trim().isLength({ min: 2 }).escape(),
    body('username').trim().isLength({ min: 3 }).escape(),
    body('password').isLength({ min: 6 }),
    body('role').isIn(['admin', 'standard']),
    async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const { name, username, password, role } = req.body;
        
        // Check if username already exists
        const existingUser = users.find(u => u.username === username);
        if (existingUser) {
            return res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
        }
        
        // Create new user
        const newUser = {
            id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
            name: name,
            username: username,
            password: bcrypt.hashSync(password, 10),
            role: role,
            isActive: true,
            createdAt: new Date().toISOString(),
            lastLogin: null
        };
        
        users.push(newUser);
        saveUsers();
        
        res.json({
            success: true,
            message: 'تم إضافة المستخدم بنجاح',
            user: {
                id: newUser.id,
                name: newUser.name,
                username: newUser.username,
                role: newUser.role
            }
        });
        
    } catch (error) {
        logger.error('Create user error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// WhatsApp User-specific Routes
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
            hasQr: !!userSession.qrCode,
            qrCode: userSession.qrCode
        });
    } catch (error) {
        logger.error('WhatsApp status error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Get user QR code
app.get('/api/user-whatsapp-qr', authenticateUser, (req, res) => {
    try {
        const userId = req.user.id;
        const userSession = getUserWhatsAppSession(userId);
        
        if (!userSession || !userSession.qrCode) {
            return res.json({
                success: false,
                message: 'QR Code غير متوفر حالياً'
            });
        }
        
        res.json({
            success: true,
            qrCode: userSession.qrCode,
            userId: userId
        });
    } catch (error) {
        logger.error('QR code error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Reconnect user WhatsApp
app.post('/api/user-reconnect-whatsapp', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.id;
        
        const result = await manualReconnectUserWhatsApp(userId);
        
        if (result) {
            res.json({
                success: true,
                message: 'جاري إعادة الاتصال بالواتساب...'
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'فشل إعادة الاتصال'
            });
        }
    } catch (error) {
        logger.error('Reconnect error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Disconnect user WhatsApp
app.post('/api/user-disconnect-whatsapp', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.id;
        
        await disconnectUserWhatsApp(userId);
        
        res.json({
            success: true,
            message: 'تم فصل الواتساب بنجاح'
        });
    } catch (error) {
        logger.error('Disconnect error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Toggle user bot
app.post('/api/user-toggle-bot', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.id;
        const { stop } = req.body;
        
        const result = toggleUserBot(userId, stop);
        
        if (result) {
            res.json({
                success: true,
                message: stop ? 'تم إيقاف البوت' : 'تم تشغيل البوت',
                stopped: stop
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'فشل تغيير حالة البوت'
            });
        }
    } catch (error) {
        logger.error('Toggle bot error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Message sending with validation
app.post('/api/send-message', 
    authenticateUser,
    body('phone').isMobilePhone('ar-SA'),
    body('message').isLength({ min: 1, max: 1000 }).trim(),
    async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const { phone, message } = req.body;
        const userId = req.user.id;
        
        if (messageQueue) {
            // Add to queue if available
            const job = await messageQueue.add({
                userId,
                phone,
                message
            });
            
            res.json({ 
                success: true, 
                message: 'تم إضافة الرسالة إلى قائمة الإرسال',
                jobId: job.id
            });
        } else {
            // Direct send
            await sendWhatsAppMessage(userId, phone, message);
            res.json({ 
                success: true, 
                message: 'تم إرسال الرسالة بنجاح'
            });
        }
    } catch (error) {
        logger.error('Send message error:', error);
        res.status(500).json({ error: 'فشل إرسال الرسالة: ' + error.message });
    }
});

// File upload route
app.post('/api/upload-excel', authenticateUser, upload.single('excelFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
        }
        
        const clients = processExcelFile(req.file.path);
        const userId = req.user.id;
        
        // Add clients to user's imported list
        const userSession = getUserWhatsAppSession(userId);
        if (userSession) {
            clients.forEach(client => {
                userSession.importedClients.add(client.phone);
            });
        }
        
        // Save clients to memory
        let existingClients = [];
        const clientsFile = './memory/clients.json';
        
        if (fs.existsSync(clientsFile)) {
            const clientsData = fs.readFileSync(clientsFile, 'utf8');
            existingClients = JSON.parse(clientsData);
        }
        
        // Merge and remove duplicates
        const allClients = [...existingClients, ...clients];
        const uniqueClients = allClients.filter((client, index, self) => 
            index === self.findIndex(c => c.phone === client.phone)
        );
        
        fs.writeFileSync(clientsFile, JSON.stringify(uniqueClients, null, 2));
        
        res.json({
            success: true,
            message: `تم معالجة ${clients.length} عميل بنجاح`,
            count: clients.length,
            clients: uniqueClients
        });
        
    } catch (error) {
        logger.error('File upload error:', error);
        res.status(500).json({ error: 'فشل معالجة الملف: ' + error.message });
    }
});

// Get clients
app.get('/api/clients', authenticateUser, (req, res) => {
    try {
        let clients = [];
        const clientsFile = './memory/clients.json';
        
        if (fs.existsSync(clientsFile)) {
            const clientsData = fs.readFileSync(clientsFile, 'utf8');
            clients = JSON.parse(clientsData);
        }
        
        res.json({
            success: true,
            clients: clients
        });
    } catch (error) {
        logger.error('Get clients error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Update client status
app.post('/api/update-client-status', authenticateUser, async (req, res) => {
    try {
        const { phone, status } = req.body;
        
        updateClientStatus(phone, status);
        
        res.json({
            success: true,
            message: 'تم تحديث حالة العميل'
        });
    } catch (error) {
        logger.error('Update client status error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Get client messages
app.get('/api/client-messages/:phone', authenticateUser, (req, res) => {
    try {
        const { phone } = req.params;
        const messages = getClientMessages(phone);
        
        res.json({
            success: true,
            messages: messages
        });
    } catch (error) {
        logger.error('Get client messages error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Employee performance
app.get('/api/employee-performance', authenticateUser, (req, res) => {
    try {
        const userId = req.user.id;
        
        if (!employeePerformance[userId]) {
            initializeUserPerformance(userId);
        }
        
        res.json({
            success: true,
            performance: employeePerformance[userId]
        });
    } catch (error) {
        logger.error('Employee performance error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Export report
app.get('/api/export-report', authenticateUser, (req, res) => {
    try {
        const userId = req.user.id;
        const result = exportReportToFile(userId);
        
        res.download(result.filePath, result.fileName);
    } catch (error) {
        logger.error('Export report error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Send report to manager
app.post('/api/send-to-manager', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.id;
        await sendReportToManager(userId);
        
        res.json({
            success: true,
            message: 'تم إرسال التقرير إلى المدير'
        });
    } catch (error) {
        logger.error('Send report error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Bulk message sending
app.post('/api/send-bulk', 
    authenticateUser,
    body('message').isLength({ min: 1, max: 1000 }).trim(),
    body('delay').isInt({ min: 10, max: 120 }),
    async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const { message, delay, clients } = req.body;
        const userId = req.user.id;
        
        if (!clients || clients.length === 0) {
            return res.status(400).json({ error: 'لا يوجد عملاء للإرسال' });
        }
        
        // Send messages with delay
        let sentCount = 0;
        const failedClients = [];
        
        for (const client of clients) {
            try {
                await new Promise(resolve => setTimeout(resolve, delay * 1000));
                await sendWhatsAppMessage(userId, client.phone, message);
                sentCount++;
                
                // Emit progress
                io.emit('bulk_progress', {
                    type: 'progress',
                    client: client.name,
                    clientPhone: client.phone,
                    success: true,
                    sentCount: sentCount,
                    totalCount: clients.length
                });
                
            } catch (error) {
                failedClients.push({
                    client: client.name,
                    phone: client.phone,
                    error: error.message
                });
                
                io.emit('bulk_progress', {
                    type: 'progress',
                    client: client.name,
                    clientPhone: client.phone,
                    success: false,
                    error: error.message
                });
            }
        }
        
        trackEmployeeActivity(userId, 'bulk_campaign', {
            clientsCount: clients.length,
            sentCount: sentCount,
            failedCount: failedClients.length
        });
        
        res.json({
            success: true,
            message: `تم إرسال ${sentCount} رسالة بنجاح`,
            sentCount: sentCount,
            failedCount: failedClients.length,
            failedClients: failedClients
        });
        
    } catch (error) {
        logger.error('Bulk send error:', error);
        res.status(500).json({ error: 'فشل الإرسال الجماعي: ' + error.message });
    }
});

// =============================================
// SOCKET.IO HANDLERS
// =============================================

io.on('connection', (socket) => {
    logger.info('Client connected');
    
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
            logger.info(`Socket authenticated for user ${user.name}`);
            
            socket.emit('authenticated', { 
                userId: user.id, 
                username: user.username 
            });
            
            const userSession = getUserWhatsAppSession(user.id);
            if (userSession) {
                socket.emit(`user_status_${user.id}`, { 
                    connected: userSession.isConnected, 
                    message: userSession.isConnected ? 'واتساب متصل ✅' : 'جارٍ الاتصال...',
                    status: userSession.status,
                    hasQr: !!userSession.qrCode,
                    userId: user.id
                });
                
                if (userSession.qrCode) {
                    socket.emit(`user_qr_${user.id}`, { 
                        qrCode: userSession.qrCode,
                        userId: user.id,
                        timestamp: new Date().toISOString()
                    });
                }
            }
            
        } catch (error) {
            logger.error('Socket authentication error:', error);
            socket.emit('auth_error', { error: 'خطأ في المصادقة' });
        }
    });
    
    socket.on('disconnect', () => {
        logger.info('Client disconnected');
    });
});

// =============================================
// GRACEFUL SHUTDOWN
// =============================================

process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    
    // Close all WhatsApp connections
    for (const [userId, session] of userWhatsAppSessions) {
        if (session.client) {
            try {
                await session.client.destroy();
            } catch (error) {
                logger.error(`Error destroying client for user ${userId}:`, error);
            }
        }
    }
    
    // Close message queue if exists
    if (messageQueue) {
        await messageQueue.close();
    }
    
    // Close server
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
    
    // Force exit after 30 seconds
    setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
    }, 30000);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// =============================================
// START SERVER
// =============================================

initializeUsers();

server.listen(config.port, '0.0.0.0', () => {
    logger.info(`🚀 Server running on port ${config.port}`);
    logger.info(`🏢 Company: ${ragmcloudCompanyInfo.name}`);
    logger.info(`📞 Phone: ${ragmcloudCompanyInfo.phone}`);
    logger.info(`🌐 Website: ${ragmcloudCompanyInfo.website}`);
    logger.info(`🔑 DeepSeek: ${deepseekAvailable ? 'ENABLED' : 'DISABLED'}`);
    logger.info(`👥 User Management: ENABLED`);
    logger.info(`🔐 Security: Enhanced with rate limiting & validation`);
    logger.info(`📊 Performance Tracking: ENABLED`);
    logger.info(`🔄 Auto-cleanup: ENABLED`);
    logger.info(`📝 Logging: Winston logger configured`);
    logger.info(`🌍 Environment: ${config.nodeEnv}`);
    logger.info(`✅ All systems operational`);
});
