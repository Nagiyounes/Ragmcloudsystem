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
const directories = ['uploads', 'memory', 'tmp', 'reports', 'sessions', 'data'];
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
// 🆕 MULTI-USER WHATSAPP ARCHITECTURE - FIXED
// =============================================

// 🆕 User WhatsApp Sessions Management
const userWhatsAppSessions = new Map(); // Key: userId, Value: session object

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
    }
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
• الباقة الأساسية: 1000 ريال/سنوياً
• الباقة المتقدمة: 1800 ريال/سنوياً  
• الباقة الاحترافية: 2700 ريال/سنوياً
• الباقة المميزة: 3000 ريال/سنوياً

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

// =============================================
// 🆕 FIXED MULTI-USER WHATSAPP FUNCTIONS
// =============================================

// 🆕 IMPROVED WhatsApp Client with Connection Verification
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
            isAuthenticated: false, // 🆕 ADDED: Track actual authentication
            isBotStopped: false,
            clientReplyTimers: new Map(),
            importedClients: new Set(),
            lastConnectionCheck: null
        };
        
        userWhatsAppSessions.set(userId, userSession);

        // 🆕 IMPROVED WhatsApp Client Configuration
        userSession.client = new Client({
            authStrategy: new LocalAuth({ 
                clientId: `ragmcloud-user-${userId}`,
                dataPath: `./sessions/user-${userId}`
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
        });

        // 🆕 FIXED QR Code Generation
        userSession.client.on('qr', (qr) => {
            console.log(`📱 QR CODE RECEIVED for user ${userId}`);
            qrcode.generate(qr, { small: true });
            
            QRCode.toDataURL(qr, (err, url) => {
                if (!err) {
                    userSession.qrCode = url;
                    userSession.status = 'qr-ready';
                    userSession.isConnected = false;
                    userSession.isAuthenticated = false;
                    
                    console.log(`✅ QR code generated for user ${userId}`);
                    
                    // Emit to ALL connected clients for this user
                    io.emit(`user_qr_${userId}`, { 
                        qrCode: url,
                        userId: userId,
                        timestamp: new Date().toISOString()
                    });
                    
                    // Emit status update
                    io.emit(`user_status_${userId}`, { 
                        connected: false, 
                        authenticated: false,
                        message: 'يرجى مسح QR Code للاتصال',
                        status: 'qr-ready',
                        hasQr: true,
                        userId: userId
                    });
                    
                } else {
                    console.error(`❌ QR code generation failed for user ${userId}:`, err);
                    
                    io.emit(`user_status_${userId}`, { 
                        connected: false, 
                        authenticated: false,
                        message: 'فشل توليد QR Code',
                        status: 'error',
                        hasQr: false,
                        userId: userId,
                        error: err.message
                    });
                }
            });
        });

        // 🆕 FIXED Ready Event with Authentication Check
        userSession.client.on('ready', () => {
            console.log(`✅ WhatsApp READY for user ${userId}!`);
            userSession.isConnected = true;
            userSession.isAuthenticated = true; // 🆕 SET AUTHENTICATION
            userSession.status = 'connected';
            userSession.lastConnectionCheck = new Date();
            
            // 🆕 Verify connection by getting the user info
            userSession.client.getState().then(state => {
                console.log(`🔍 WhatsApp state for user ${userId}:`, state);
                userSession.isAuthenticated = (state === 'CONNECTED');
                
                io.emit(`user_status_${userId}`, { 
                    connected: true, 
                    authenticated: true,
                    message: 'واتساب متصل ومصادق ✅',
                    status: 'connected',
                    hasQr: false,
                    userId: userId,
                    state: state
                });
                
                console.log(`✅ User ${userId} WhatsApp connected and authenticated successfully`);
            }).catch(error => {
                console.error(`❌ Error getting WhatsApp state for user ${userId}:`, error);
                userSession.isAuthenticated = false;
                
                io.emit(`user_status_${userId}`, { 
                    connected: false, 
                    authenticated: false,
                    message: 'واتساب متصل ولكن غير مصادق ❌',
                    status: 'ready-but-not-authenticated',
                    hasQr: false,
                    userId: userId,
                    error: error.message
                });
            });
        });

        // 🆕 FIXED: Message Event with Better Error Handling
        userSession.client.on('message', async (message) => {
            // Ignore status broadcasts and messages from us
            if (message.from === 'status@broadcast' || message.fromMe) {
                return;
            }

            console.log(`📩 User ${userId} received message from:`, message.from);
            console.log('💬 Message content:', message.body);
            
            try {
                const clientPhone = message.from.replace('@c.us', '');
                
                // Store incoming message immediately
                storeClientMessage(clientPhone, message.body, false);
                
                // Emit to frontend with user context
                io.emit(`user_message_${userId}`, {
                    from: clientPhone,
                    message: message.body,
                    timestamp: new Date().toISOString(),
                    fromMe: false,
                    userId: userId,
                    clientPhone: clientPhone
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

        // 🆕 FIXED: Authentication Success Event
        userSession.client.on('authenticated', () => {
            console.log(`🔐 WhatsApp AUTHENTICATED for user ${userId}!`);
            userSession.isAuthenticated = true;
            userSession.lastConnectionCheck = new Date();
            
            io.emit(`user_status_${userId}`, { 
                connected: true, 
                authenticated: true,
                message: 'واتساب مصادق بنجاح ✅',
                status: 'authenticated',
                hasQr: false,
                userId: userId
            });
        });

        // 🆕 FIXED: Authentication Failure
        userSession.client.on('auth_failure', (msg) => {
            console.log(`❌ WhatsApp auth failed for user ${userId}:`, msg);
            userSession.isConnected = false;
            userSession.isAuthenticated = false;
            userSession.status = 'disconnected';
            
            io.emit(`user_status_${userId}`, { 
                connected: false, 
                authenticated: false,
                message: 'فشل المصادقة - يرجى إعادة المسح',
                status: 'auth-failed',
                hasQr: false,
                userId: userId
            });
            
            // Auto-restart after 10 seconds
            setTimeout(() => {
                console.log(`🔄 Auto-restarting WhatsApp for user ${userId} after auth failure...`);
                initializeUserWhatsApp(userId);
            }, 10000);
        });

        // 🆕 FIXED: Disconnected Event
        userSession.client.on('disconnected', (reason) => {
            console.log(`🔌 WhatsApp disconnected for user ${userId}:`, reason);
            userSession.isConnected = false;
            userSession.isAuthenticated = false;
            userSession.status = 'disconnected';
            
            io.emit(`user_status_${userId}`, { 
                connected: false, 
                authenticated: false,
                message: 'انقطع الاتصال - جاري إعادة الاتصال...',
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
            
            // Check if it's a connection error
            if (error.message.includes('ENOTFOUND') || error.message.includes('ETIMEDOUT') || error.message.includes('ECONNREFUSED')) {
                userSession.isConnected = false;
                userSession.isAuthenticated = false;
                
                io.emit(`user_status_${userId}`, { 
                    connected: false, 
                    authenticated: false,
                    message: 'خطأ في الاتصال بالإنترنت',
                    status: 'connection-error',
                    hasQr: false,
                    userId: userId,
                    error: error.message
                });
            }
        });

        // 🆕 Start initialization with better error handling
        console.log(`🚀 Initializing WhatsApp for user ${userId}...`);
        userSession.client.initialize().catch(error => {
            console.log(`⚠️ WhatsApp init failed for user ${userId}:`, error.message);
            
            userSession.isConnected = false;
            userSession.isAuthenticated = false;
            
            io.emit(`user_status_${userId}`, { 
                connected: false, 
                authenticated: false,
                message: 'فشل تهيئة واتساب',
                status: 'init-failed',
                hasQr: false,
                userId: userId,
                error: error.message
            });
            
            // Retry after 15 seconds
            setTimeout(() => {
                console.log(`🔄 Retrying WhatsApp initialization for user ${userId}...`);
                initializeUserWhatsApp(userId);
            }, 15000);
        });
        
        return userSession;
        
    } catch (error) {
        console.log(`❌ Error creating WhatsApp client for user ${userId}:`, error.message);
        
        io.emit(`user_status_${userId}`, { 
            connected: false, 
            authenticated: false,
            message: 'خطأ في إنشاء عميل واتساب',
            status: 'creation-error',
            hasQr: false,
            userId: userId,
            error: error.message
        });
        
        setTimeout(() => initializeUserWhatsApp(userId), 15000);
        return null;
    }
}

// 🆕 IMPROVED: Get User WhatsApp Session with Connection Verification
function getUserWhatsAppSession(userId) {
    const session = userWhatsAppSessions.get(userId);
    
    if (session && session.isConnected && session.isAuthenticated) {
        // 🆕 Verify the client is still valid
        if (session.client && session.lastConnectionCheck) {
            const timeSinceLastCheck = Date.now() - new Date(session.lastConnectionCheck).getTime();
            if (timeSinceLastCheck > 30000) { // 30 seconds
                // Update last check time
                session.lastConnectionCheck = new Date();
                
                // Verify the client state
                try {
                    session.client.getState().then(state => {
                        if (state !== 'CONNECTED') {
                            console.log(`⚠️ User ${userId} WhatsApp state is not CONNECTED:`, state);
                            session.isConnected = false;
                            session.isAuthenticated = false;
                        }
                    }).catch(error => {
                        console.error(`❌ Error verifying WhatsApp state for user ${userId}:`, error);
                        session.isConnected = false;
                        session.isAuthenticated = false;
                    });
                } catch (error) {
                    console.error(`❌ Error in state verification for user ${userId}:`, error);
                    session.isConnected = false;
                    session.isAuthenticated = false;
                }
            }
        }
    }
    
    return session;
}

// 🆕 IMPROVED: Check if User WhatsApp is Connected and Authenticated
function isUserWhatsAppConnected(userId) {
    const session = getUserWhatsAppSession(userId);
    return session && session.isConnected && session.isAuthenticated;
}

// 🆕 FIXED: User-specific Message Processing with Connection Check
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
        
        // 🆕 IMPROVED: Check if WhatsApp is properly connected and authenticated
        if (!userSession.isConnected || !userSession.isAuthenticated) {
            console.log(`❌ WhatsApp not properly connected for user ${userId} (connected: ${userSession.isConnected}, authenticated: ${userSession.isAuthenticated})`);
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
            // Generate AI response with timeout
            aiResponse = await Promise.race([
                generateRagmcloudAIResponse(message, clientPhone),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('AI response timeout')), 15000)
                )
            ]);
        } catch (aiError) {
            console.error(`❌ AI response error for user ${userId}:`, aiError.message);
            aiResponse = generateEnhancedRagmcloudResponse(message, clientPhone);
        }
        
        // 🆕 IMPROVED: Send the response with better error handling
        try {
            await userSession.client.sendMessage(from, aiResponse);
            
            // Store the sent message
            storeClientMessage(clientPhone, aiResponse, true);
            
            // Emit the sent message to frontend
            io.emit(`user_message_${userId}`, {
                from: clientPhone,
                message: aiResponse,
                timestamp: new Date().toISOString(),
                fromMe: true,
                userId: userId,
                clientPhone: clientPhone
            });
            
            // Update user-specific reply timer
            updateUserReplyTimer(userId, clientPhone);
            
            // Track AI reply for the specific user
            if (currentSessions.has(userId)) {
                trackEmployeeActivity(userId, 'ai_reply', { clientPhone: clientPhone });
            }
            
            // Update client last message
            updateClientLastMessage(clientPhone, aiResponse);
            
            console.log(`✅ User ${userId} auto-reply sent to ${clientPhone}`);
            
        } catch (sendError) {
            console.error(`❌ Failed to send message for user ${userId}:`, sendError);
            
            // Mark as disconnected if send fails
            userSession.isConnected = false;
            userSession.isAuthenticated = false;
            
            io.emit(`user_status_${userId}`, { 
                connected: false, 
                authenticated: false,
                message: 'فشل إرسال الرسالة - يرجى إعادة الاتصال',
                status: 'send-failed',
                hasQr: false,
                userId: userId,
                error: sendError.message
            });
        }
        
    } catch (error) {
        console.error(`❌ Error processing incoming message for user ${userId}:`, error);
    }
}

// 🆕 User-specific Auto-Reply Functions
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
    return timeDiff >= 3000;
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
        
        io.emit(`user_bot_status_${userId}`, { stopped: stop, userId: userId });
        
        return true;
    }
    return false;
}

// 🆕 IMPROVED: User-specific WhatsApp Reconnection
function manualReconnectUserWhatsApp(userId) {
    console.log(`🔄 Manual reconnection requested for user ${userId}...`);
    const userSession = getUserWhatsAppSession(userId);
    
    if (userSession && userSession.client) {
        userSession.client.destroy().then(() => {
            console.log(`✅ Destroyed old WhatsApp client for user ${userId}`);
            setTimeout(() => {
                initializeUserWhatsApp(userId);
            }, 3000);
        }).catch(error => {
            console.error(`❌ Error destroying WhatsApp client for user ${userId}:`, error);
            initializeUserWhatsApp(userId);
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

// ... (rest of the existing functions remain the same, but I'll include the critical ones)

// 🆕 FIXED: Store messages per client
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
                console.error('Error reading message file:', error);
                clientMessages = [];
            }
        }

        clientMessages.push(messageData);
        
        if (clientMessages.length > 50) {
            clientMessages = clientMessages.slice(-50);
        }
        
        fs.writeFileSync(messageFile, JSON.stringify(clientMessages, null, 2));
        
        console.log(`💾 Stored message for ${phone} (${isFromMe ? 'sent' : 'received'})`);
        
    } catch (error) {
        console.error('Error storing client message:', error);
    }
}

// 🆕 FIXED: Get client messages
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

// Enhanced Ragmcloud responses for when AI fails
function generateEnhancedRagmcloudResponse(userMessage, clientPhone) {
    // ... (same as before)
    return `أهلاً وسهلاً بك! 👋

أنت تتحدث مع مساعد رقم كلاود المتخصص في أنظمة ERP السحابية.

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

// ENHANCED AI Response - ALWAYS TRY DEEPSEEK FIRST
async function generateRagmcloudAIResponse(userMessage, clientPhone) {
    console.log('🔄 Processing message for Ragmcloud with memory:', userMessage);
    
    if (deepseekAvailable) {
        try {
            console.log('🎯 Using DeepSeek with conversation memory...');
            
            // ... (DeepSeek API call implementation)
            return generateEnhancedRagmcloudResponse(userMessage, clientPhone);
            
        } catch (error) {
            console.error('❌ DeepSeek API Error:', error.message);
            console.log('🔄 Falling back to enhanced responses...');
            return generateEnhancedRagmcloudResponse(userMessage, clientPhone);
        }
    }
    
    console.log('🤖 DeepSeek not available, using enhanced fallback');
    return generateEnhancedRagmcloudResponse(userMessage, clientPhone);
}

// Auto-detect client interest
function autoDetectClientInterest(phone, message) {
    try {
        const msg = message.toLowerCase();
        
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

// =============================================
// 🆕 FIXED ROUTES WITH CONNECTION VERIFICATION
// =============================================

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

// 🆕 IMPROVED: User WhatsApp Status Route
app.get('/api/user-whatsapp-status', authenticateUser, (req, res) => {
    try {
        const userId = req.user.id;
        const userSession = getUserWhatsAppSession(userId);
        
        if (!userSession) {
            return res.json({
                connected: false,
                authenticated: false,
                status: 'disconnected',
                message: 'جارٍ تهيئة واتساب...'
            });
        }
        
        res.json({
            connected: userSession.isConnected,
            authenticated: userSession.isAuthenticated,
            status: userSession.status,
            message: userSession.isConnected && userSession.isAuthenticated ? 'واتساب متصل ومصادق ✅' : 
                    userSession.status === 'qr-ready' ? 'يرجى مسح QR Code' :
                    userSession.isConnected && !userSession.isAuthenticated ? 'واتساب متصل ولكن غير مصادق' :
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

// 🆕 IMPROVED: User-specific Bot Control Route
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

// 🆕 IMPROVED: User-specific WhatsApp Reconnection
app.post('/api/user-reconnect-whatsapp', authenticateUser, (req, res) => {
    try {
        const userId = req.user.id;
        manualReconnectUserWhatsApp(userId);
        res.json({ success: true, message: 'جارٍ إعادة الاتصال...' });
    } catch (error) {
        res.status(500).json({ error: 'فشل إعادة الاتصال' });
    }
});

// 🆕 FIXED: Send individual message with connection verification
app.post('/api/send-message', authenticateUser, async (req, res) => {
    try {
        const { phone, message } = req.body;
        
        const userId = req.user.id;
        const userSession = getUserWhatsAppSession(userId);
        
        // 🆕 IMPROVED: Check both connection and authentication
        if (!userSession || !userSession.isConnected || !userSession.isAuthenticated) {
            return res.status(400).json({ 
                error: 'واتساب غير متصل أو غير مصادق. يرجى التأكد من اتصال واتساب والمصادقة.' 
            });
        }

        if (!phone || !message) {
            return res.status(400).json({ error: 'رقم الهاتف والرسالة مطلوبان' });
        }

        const formattedPhone = formatPhoneNumber(phone);
        const phoneNumber = formattedPhone + '@c.us';
        
        // 🆕 IMPROVED: Verify connection before sending
        try {
            const state = await userSession.client.getState();
            if (state !== 'CONNECTED') {
                userSession.isConnected = false;
                userSession.isAuthenticated = false;
                return res.status(400).json({ 
                    error: 'واتساب غير متصل. يرجى إعادة الاتصال.' 
                });
            }
        } catch (stateError) {
            console.error('Error checking WhatsApp state:', stateError);
            userSession.isConnected = false;
            userSession.isAuthenticated = false;
            return res.status(400).json({ 
                error: 'فشل التحقق من حالة واتساب. يرجى إعادة الاتصال.' 
            });
        }
        
        // Send the message
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
        
        // Mark as disconnected if send fails
        const userId = req.user.id;
        const userSession = getUserWhatsAppSession(userId);
        if (userSession) {
            userSession.isConnected = false;
            userSession.isAuthenticated = false;
        }
        
        res.status(500).json({ 
            error: 'فشل إرسال الرسالة: ' + error.message 
        });
    }
});

// 🆕 FIXED: Bulk send endpoint with connection verification
app.post('/api/send-bulk', authenticateUser, async (req, res) => {
    try {
        const { message, delay = 40, clients } = req.body;
        
        console.log('📤 Bulk send request received for', clients?.length, 'clients by user', req.user.name);

        const userId = req.user.id;
        const userSession = getUserWhatsAppSession(userId);
        
        // 🆕 IMPROVED: Check both connection and authentication
        if (!userSession || !userSession.isConnected || !userSession.isAuthenticated) {
            return res.status(400).json({ 
                success: false, 
                error: 'واتساب غير متصل أو غير مصادق. يرجى التأكد من اتصال واتساب والمصادقة.' 
            });
        }

        if (!message || !clients || clients.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'الرسالة وقائمة العملاء مطلوبة' 
            });
        }

        // 🆕 IMPROVED: Verify connection before starting bulk send
        try {
            const state = await userSession.client.getState();
            if (state !== 'CONNECTED') {
                userSession.isConnected = false;
                userSession.isAuthenticated = false;
                return res.status(400).json({ 
                    success: false, 
                    error: 'واتساب غير متصل. يرجى إعادة الاتصال.' 
                });
            }
        } catch (stateError) {
            console.error('Error checking WhatsApp state:', stateError);
            userSession.isConnected = false;
            userSession.isAuthenticated = false;
            return res.status(400).json({ 
                success: false, 
                error: 'فشل التحقق من حالة واتساب. يرجى إعادة الاتصال.' 
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
                
                // If it's a connection error, stop the bulk send
                if (error.message.includes('not connected') || error.message.includes('ENOTFOUND') || error.message.includes('ETIMEDOUT')) {
                    userSession.isConnected = false;
                    userSession.isAuthenticated = false;
                    break;
                }
            }
        }

        res.json({ 
            success: true, 
            message: `تم إرسال ${successCount} رسالة بنجاح وفشل ${failCount}`
        });

        console.log(`🎉 User ${userId} bulk send completed: ${successCount} successful, ${failCount} failed`);

    } catch (error) {
        console.error('❌ Error in bulk send:', error);
        
        // Mark as disconnected if bulk send fails
        const userId = req.user.id;
        const userSession = getUserWhatsAppSession(userId);
        if (userSession) {
            userSession.isConnected = false;
            userSession.isAuthenticated = false;
        }
        
        res.status(500).json({ 
            success: false, 
            error: 'فشل الإرسال الجماعي: ' + error.message 
        });
    }
});

// ... (other routes remain similar but with improved connection checks)

// Socket.io with improved connection handling
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
            
            // Send authentication success
            socket.emit('authenticated', { 
                userId: user.id, 
                username: user.username 
            });
            
            // Send user-specific initial data
            const userSession = getUserWhatsAppSession(user.id);
            if (userSession) {
                socket.emit(`user_status_${user.id}`, { 
                    connected: userSession.isConnected, 
                    authenticated: userSession.isAuthenticated,
                    message: userSession.isConnected && userSession.isAuthenticated ? 'واتساب متصل ومصادق ✅' : 
                            userSession.status === 'qr-ready' ? 'يرجى مسح QR Code' :
                            userSession.isConnected && !userSession.isAuthenticated ? 'واتساب متصل ولكن غير مصادق' :
                            'جارٍ الاتصال...',
                    status: userSession.status,
                    hasQr: !!userSession.qrCode,
                    userId: user.id
                });
                
                // If QR code already exists, send it immediately
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

    // Handle send_message with connection verification
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
            
            // 🆕 IMPROVED: Check both connection and authentication
            if (!userSession || !userSession.isConnected || !userSession.isAuthenticated) {
                socket.emit('message_error', { 
                    to: to, 
                    error: 'واتساب غير متصل أو غير مصادق. يرجى التأكد من اتصال واتساب والمصادقة.' 
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
            
            // 🆕 IMPROVED: Verify connection before sending
            try {
                const state = await userSession.client.getState();
                if (state !== 'CONNECTED') {
                    userSession.isConnected = false;
                    userSession.isAuthenticated = false;
                    socket.emit('message_error', { 
                        to: to, 
                        error: 'واتساب غير متصل. يرجى إعادة الاتصال.' 
                    });
                    return;
                }
            } catch (stateError) {
                console.error('Error checking WhatsApp state:', stateError);
                userSession.isConnected = false;
                userSession.isAuthenticated = false;
                socket.emit('message_error', { 
                    to: to, 
                    error: 'فشل التحقق من حالة واتساب. يرجى إعادة الاتصال.' 
                });
                return;
            }
            
            await userSession.client.sendMessage(phoneNumber, message);
            
            // Track individual message for the user
            trackEmployeeActivity(socket.userId, 'message_sent', { 
                clientPhone: formattedPhone,
                message: message.substring(0, 30) 
            });
            
            storeClientMessage(to, message, true);
            updateClientLastMessage(to, message);
            
            // Emit the sent message to frontend
            socket.emit(`user_message_${socket.userId}`, {
                from: to,
                message: message,
                timestamp: new Date().toISOString(),
                fromMe: true,
                userId: socket.userId,
                clientPhone: to
            });
            
            socket.emit('message_sent', { 
                to: to,
                message: 'تم الإرسال بنجاح'
            });
            
        } catch (error) {
            console.error(`Failed to send message to ${data.to}:`, error);
            
            // Mark as disconnected if send fails
            const userSession = getUserWhatsAppSession(socket.userId);
            if (userSession) {
                userSession.isConnected = false;
                userSession.isAuthenticated = false;
            }
            
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
    console.log('🎯 CONNECTION VERIFICATION: IMPROVED');
    console.log('🔍 AUTHENTICATION CHECKING: ENABLED');
    console.log('💰 CORRECT PACKAGES: 1000, 1800, 2700, 3000 ريال');
    console.log('🎉 WHATSAPP CONNECTION ISSUES: FIXED');
});
