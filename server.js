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
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

// Load environment variables
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// =============================================
// 🗄️ MONGODB DATABASE CONNECTION
// =============================================

const uri = "mongodb+srv://ragm_user:Admin1020@cluster0.q7bnvpm.mongodb.net/ragmcloud-erp?retryWrites=true&w=majority&appName=Cluster0";

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let db;

// Connect to MongoDB
async function connectDB() {
    try {
        await client.connect();
        db = client.db('ragmcloud-erp');
        console.log('🗄️  MONGODB ATLAS: CONNECTED ✅');
        
        // Create indexes for better performance
        await db.collection('users').createIndex({ username: 1 }, { unique: true });
        await db.collection('clients').createIndex({ phone: 1 }, { unique: true });
        await db.collection('messages').createIndex({ phone: 1, timestamp: -1 });
        await db.collection('performance').createIndex({ userId: 1, date: 1 }, { unique: true });
        
        return db;
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        process.exit(1);
    }
}

connectDB();

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
// 🗄️ DATABASE FUNCTIONS
// =============================================

// Initialize default users
async function initializeUsers() {
    try {
        const usersCount = await db.collection('users').countDocuments();
        
        if (usersCount === 0) {
            const defaultUsers = [
                {
                    name: 'المدير',
                    username: 'admin',
                    password: bcrypt.hashSync('admin123', 10),
                    role: 'admin',
                    isActive: true,
                    createdAt: new Date(),
                    lastLogin: null
                },
                {
                    name: 'محمد أحمد',
                    username: 'mohamed',
                    password: bcrypt.hashSync('user123', 10),
                    role: 'standard',
                    isActive: true,
                    createdAt: new Date(),
                    lastLogin: null
                }
            ];
            
            await db.collection('users').insertMany(defaultUsers);
            console.log('✅ Created default users in MongoDB');
        } else {
            console.log(`✅ Loaded ${usersCount} users from MongoDB`);
        }
        
        // Load users into memory
        users = await db.collection('users').find({ isActive: true }).toArray();
    } catch (error) {
        console.error('❌ Error initializing users:', error);
    }
}

// Save users to database
async function saveUsers() {
    try {
        // Users are now stored in MongoDB, no need for file-based saving
        console.log('✅ Users are stored in MongoDB');
    } catch (error) {
        console.error('❌ Error saving users:', error);
    }
}

// Store client message in MongoDB
async function storeClientMessage(phone, message, isFromMe, userId = null) {
    try {
        await db.collection('messages').insertOne({
            phone: phone,
            message: message,
            fromMe: isFromMe,
            userId: userId ? new ObjectId(userId) : null,
            timestamp: new Date()
        });
        
        console.log(`💾 Stored message for ${phone} in MongoDB (${isFromMe ? 'sent' : 'received'})`);
    } catch (error) {
        console.error('Error storing client message in MongoDB:', error);
    }
}

// Get client messages from MongoDB
async function getClientMessages(phone, limit = 50) {
    try {
        const messages = await db.collection('messages')
            .find({ phone: phone })
            .sort({ timestamp: 1 })
            .limit(limit)
            .toArray();
        
        return messages;
    } catch (error) {
        console.error('Error getting client messages from MongoDB:', error);
        return [];
    }
}

// Save or update client in MongoDB
async function saveClient(clientData, userId = null) {
    try {
        await db.collection('clients').updateOne(
            { phone: clientData.phone },
            {
                $set: {
                    ...clientData,
                    importedBy: userId ? new ObjectId(userId) : null,
                    lastActivity: new Date()
                }
            },
            { upsert: true }
        );
    } catch (error) {
        console.error('Error saving client to MongoDB:', error);
        throw error;
    }
}

// Get all clients from MongoDB
async function getClients(userId = null) {
    try {
        let query = {};
        if (userId) {
            query.importedBy = new ObjectId(userId);
        }
        
        const clients = await db.collection('clients')
            .find(query)
            .sort({ lastActivity: -1 })
            .toArray();
        
        return clients;
    } catch (error) {
        console.error('Error getting clients from MongoDB:', error);
        return [];
    }
}

// Update client status in MongoDB
async function updateClientStatus(phone, status) {
    try {
        await db.collection('clients').updateOne(
            { phone: phone },
            { 
                $set: {
                    status: status,
                    statusUpdatedAt: new Date()
                }
            }
        );
        
        console.log(`🔄 Updated client ${phone} status to: ${status} in MongoDB`);
        
        // Emit status update to frontend
        const clients = await getClients();
        io.emit('client_status_updated', {
            phone: phone,
            status: status,
            clients: clients
        });
    } catch (error) {
        console.error('Error updating client status in MongoDB:', error);
    }
}

// Initialize user performance tracking in MongoDB
async function initializeUserPerformance(userId) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const performance = await db.collection('performance').findOne({ 
            userId: new ObjectId(userId), 
            date: today 
        });
        
        if (!performance) {
            const newPerformance = {
                userId: new ObjectId(userId),
                date: today,
                dailyStats: {
                    messagesSent: 0,
                    clientsContacted: 0,
                    aiRepliesSent: 0,
                    bulkCampaigns: 0,
                    interestedClients: 0,
                    startTime: new Date(),
                    lastActivity: new Date()
                },
                clientInteractions: [],
                messageHistory: []
            };
            
            await db.collection('performance').insertOne(newPerformance);
            employeePerformance[userId] = newPerformance;
        } else {
            employeePerformance[userId] = performance;
        }
    } catch (error) {
        console.error('Error initializing user performance in MongoDB:', error);
    }
}

// Track employee activity in MongoDB
async function trackEmployeeActivity(userId, type, data = {}) {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // Update daily stats
        const updateFields = {};
        updateFields['dailyStats.lastActivity'] = new Date();
        
        switch (type) {
            case 'message_sent':
                updateFields['$inc'] = { 'dailyStats.messagesSent': 1 };
                break;
            case 'ai_reply':
                updateFields['$inc'] = { 'dailyStats.aiRepliesSent': 1 };
                break;
            case 'bulk_campaign':
                updateFields['$inc'] = { 'dailyStats.bulkCampaigns': 1 };
                break;
            case 'client_interested':
                updateFields['$inc'] = { 'dailyStats.interestedClients': 1 };
                break;
        }

        // Add to message history
        if (type !== 'client_interested') {
            updateFields['$push'] = {
                messageHistory: {
                    timestamp: new Date(),
                    type: type,
                    ...data
                }
            };
        }

        // Update client interactions
        if (data.clientPhone) {
            await updateClientInteraction(userId, data.clientPhone, data.clientName, today);
        }

        await db.collection('performance').updateOne(
            { userId: new ObjectId(userId), date: today },
            updateFields,
            { upsert: true }
        );

        // Reload performance data
        employeePerformance[userId] = await db.collection('performance').findOne({ 
            userId: new ObjectId(userId), 
            date: today 
        });

        // Check if we should auto-send report to manager
        checkAutoSendReport(userId);
        
    } catch (error) {
        console.error('Error tracking employee activity in MongoDB:', error);
    }
}

// Update client interaction in MongoDB
async function updateClientInteraction(userId, clientPhone, clientName = '', date) {
    try {
        const performance = await db.collection('performance').findOne({ 
            userId: new ObjectId(userId), 
            date: date 
        });

        const existingInteraction = performance.clientInteractions.find(
            interaction => interaction.phone === clientPhone
        );

        if (existingInteraction) {
            // Update existing interaction
            await db.collection('performance').updateOne(
                { 
                    userId: new ObjectId(userId), 
                    date: date,
                    'clientInteractions.phone': clientPhone 
                },
                {
                    $set: {
                        'clientInteractions.$.lastMessage': new Date()
                    },
                    $inc: {
                        'clientInteractions.$.messageCount': 1
                    }
                }
            );
        } else {
            // Add new interaction and increment clientsContacted
            await db.collection('performance').updateOne(
                { userId: new ObjectId(userId), date: date },
                {
                    $push: {
                        clientInteractions: {
                            phone: clientPhone,
                            clientName: clientName,
                            firstContact: new Date(),
                            lastMessage: new Date(),
                            messageCount: 1,
                            interested: false
                        }
                    },
                    $inc: { 'dailyStats.clientsContacted': 1 }
                }
            );
        }
    } catch (error) {
        console.error('Error updating client interaction in MongoDB:', error);
    }
}

// =============================================
// 🆕 MULTI-USER WHATSAPP FUNCTIONS (UPDATED FOR MONGODB)
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
                const clientPhone = message.from.replace('@c.us', '');
                
                // Store incoming message in MongoDB
                await storeClientMessage(clientPhone, message.body, false, userId);
                
                // Emit to frontend with user context
                io.emit(`user_message_${userId}`, {
                    from: clientPhone,
                    message: message.body,
                    timestamp: new Date(),
                    fromMe: false,
                    userId: userId
                });

                // Update client last message in MongoDB
                await updateClientLastMessage(clientPhone, message.body, userId);

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
    return session && session.status === 'connected';
}

// 🆕 User-specific Message Processing
async function processUserIncomingMessage(userId, message, from) {
    try {
        console.log(`📩 User ${userId} processing message from ${from}: ${message}`);
        
        const clientPhone = from.replace('@c.us', '');
        
        // Store the incoming message in MongoDB
        await storeClientMessage(clientPhone, message, false, userId);
        
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
            // Generate AI response with timeout
            aiResponse = await Promise.race([
                generateRagmcloudAIResponse(message, clientPhone),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('AI response timeout')), 15000)
                )
            ]);
        } catch (aiError) {
            console.error(`❌ AI response error for user ${userId}:`, aiError.message);
            // Use enhanced fallback response instead of error message
            aiResponse = generateEnhancedRagmcloudResponse(message, clientPhone);
        }
        
        // Send the response using user's WhatsApp client
        await userSession.client.sendMessage(from, aiResponse);
        
        // Store the sent message in MongoDB
        await storeClientMessage(clientPhone, aiResponse, true, userId);
        
        // Update user-specific reply timer
        updateUserReplyTimer(userId, clientPhone);
        
        // Track AI reply for the specific user in MongoDB
        if (currentSessions.has(userId)) {
            await trackEmployeeActivity(userId, 'ai_reply', { clientPhone: clientPhone });
        }
        
        // Update client last message in MongoDB
        await updateClientLastMessage(clientPhone, aiResponse, userId);
        
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
// EXISTING FUNCTIONS (Updated for MongoDB)
// =============================================

// Generate JWT token
function generateToken(user) {
    return jwt.sign(
        { 
            userId: user._id.toString(), 
            username: user.username,
            role: user.role 
        },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
}

// Verify JWT token
function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}

// Authentication middleware
function authenticateUser(req, res, next) {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ error: 'الوصول مرفوض. لا يوجد token.' });
    }
    
    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ error: 'Token غير صالح.' });
    }
    
    // Find user in MongoDB
    db.collection('users').findOne({ _id: new ObjectId(decoded.userId), isActive: true })
        .then(user => {
            if (!user) {
                return res.status(401).json({ error: 'المستخدم غير موجود.' });
            }
            req.user = user;
            next();
        })
        .catch(error => {
            res.status(500).json({ error: 'خطأ في الخادم' });
        });
}

// Admin authorization middleware
function authorizeAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'غير مصرح بالوصول. تحتاج صلاحيات مدير.' });
    }
    next();
}

// Function to determine if greeting should be sent
function shouldSendGreeting(phone) {
    // This function would need to be updated to query MongoDB
    // For now, we'll return true to keep it simple
    return true;
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
        
        // Update client status in MongoDB
        updateClientStatus(phone, newStatus);
        
        return newStatus;
    } catch (error) {
        console.error('Error auto-detecting client interest:', error);
        return 'no-reply';
    }
}

// Update client last message in MongoDB
async function updateClientLastMessage(phone, message, userId = null) {
    try {
        await db.collection('clients').updateOne(
            { phone: phone },
            {
                $set: {
                    lastMessage: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
                    lastActivity: new Date()
                }
            },
            { upsert: true }
        );
        
        // Emit clients update
        const clients = await getClients(userId);
        io.emit('clients_updated', clients);
    } catch (error) {
        console.error('Error updating client last message in MongoDB:', error);
    }
}

// ENHANCED: Get conversation history for AI context from MongoDB
async function getConversationHistoryForAI(phone, maxMessages = 10) {
    try {
        const messages = await getClientMessages(phone, maxMessages);
        
        // Format conversation history for AI
        const conversationHistory = messages.map(msg => {
            const role = msg.fromMe ? 'assistant' : 'user';
            return {
                role: role,
                content: msg.message
            };
        });
        
        console.log(`📚 Loaded ${conversationHistory.length} previous messages for context from MongoDB`);
        return conversationHistory;
    } catch (error) {
        console.error('Error getting conversation history from MongoDB:', error);
        return [];
    }
}

// ENHANCED: DeepSeek AI API Call with Conversation Memory
async function callDeepSeekAI(userMessage, clientPhone) {
    if (!deepseekAvailable || !process.env.DEEPSEEK_API_KEY) {
        throw new Error('DeepSeek not available');
    }

    try {
        console.log('🚀 Calling DeepSeek API...');
        
        const shouldGreet = shouldSendGreeting(clientPhone);
        const conversationHistory = await getConversationHistoryForAI(clientPhone);
        
        // Build messages array
        const messages = [
            {
                role: "system",
                content: AI_SYSTEM_PROMPT
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

// Enhanced Ragmcloud responses for when AI fails
function generateEnhancedRagmcloudResponse(userMessage, clientPhone) {
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
        return "أعتذر، هذا السؤال خارج نطاق تخصصي في أنظمة ERP. يمكنني مساعدتك في اختيار النظام المناسب لشركتك أو الإجابة على استفساراتك حول باقاتنا وخدماتنا.";
    }
    
    // Greeting only at start or after 5 hours
    if (shouldGreet && (msg.includes('السلام') || msg.includes('سلام') || msg.includes('اهلا') || 
        msg.includes('مرحبا') || msg.includes('اهلين') || msg.includes('مساء') || 
        msg.includes('صباح') || msg.includes('hello') || msg.includes('hi'))) {
        return `السلام عليكم ورحمة الله وبركاته 🌟

أهلاً وسهلاً بك! أنا مساعدك في نظام رقم كلاود ERP.

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
    
    // ALWAYS try DeepSeek first if available
    if (deepseekAvailable) {
        try {
            console.log('🎯 Using DeepSeek with conversation memory...');
            
            const aiResponse = await callDeepSeekAI(userMessage, clientPhone);
            
            console.log('✅ DeepSeek Response successful');
            console.log('💬 AI Reply:', aiResponse);
            return aiResponse;
            
        } catch (error) {
            console.error('❌ DeepSeek API Error:', error.message);
            console.log('🔄 Falling back to enhanced responses...');
            return generateEnhancedRagmcloudResponse(userMessage, clientPhone);
        }
    }
    
    // If DeepSeek not available, use enhanced fallback
    console.log('🤖 DeepSeek not available, using enhanced fallback');
    return generateEnhancedRagmcloudResponse(userMessage, clientPhone);
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

// Generate user performance report from MongoDB
async function generateUserPerformanceReport(userId) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const performance = await db.collection('performance').findOne({ 
            userId: new ObjectId(userId), 
            date: today 
        });

        if (!performance) {
            return "لا توجد بيانات أداء لهذا اليوم.";
        }

        const stats = performance.dailyStats;
        const totalInteractions = stats.messagesSent + stats.aiRepliesSent;
        const interestRate = stats.clientsContacted > 0 ? (stats.interestedClients / stats.clientsContacted * 100).toFixed(1) : 0;
        
        // Calculate performance score (0-100)
        let performanceScore = 0;
        performanceScore += Math.min(stats.messagesSent * 2, 30);
        performanceScore += Math.min(stats.clientsContacted * 5, 30);
        performanceScore += Math.min(stats.interestedClients * 10, 40);
        
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

        const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
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
    } catch (error) {
        console.error('Error generating performance report:', error);
        return "خطأ في توليد التقرير.";
    }
}

// Check if we should auto-send report to manager
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

// Send report to manager
async function sendReportToManager(userId = null) {
    try {
        let report;
        if (userId) {
            report = await generateUserPerformanceReport(userId);
        } else {
            // Generate combined report for all users
            report = "📊 **تقرير أداء الفريق الكامل**\n\n";
            for (const [uid, session] of currentSessions) {
                if (session.isActive) {
                    report += await generateUserPerformanceReport(uid) + "\n\n" + "=".repeat(50) + "\n\n";
                }
            }
        }
        
        const managerPhone = '966531304279@c.us';
        
        console.log('📤 Sending report to manager:', managerPhone);
        
        // Find any connected user to send the report
        let senderSession = null;
        for (const [uid, session] of userWhatsAppSessions) {
            if (session.status === 'connected') {
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

// NEW: Authentication Routes (Updated for MongoDB)
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
        }
        
        const user = await db.collection('users').findOne({ username: username, isActive: true });
        if (!user) {
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }
        
        const isPasswordValid = bcrypt.compareSync(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }
        
        // Update last login
        await db.collection('users').updateOne(
            { _id: user._id },
            { $set: { lastLogin: new Date() } }
        );
        
        // Initialize user performance tracking
        await initializeUserPerformance(user._id.toString());
        
        // 🆕 Initialize user WhatsApp session
        initializeUserWhatsApp(user._id.toString());
        
        // Create session
        const token = generateToken(user);
        currentSessions.set(user._id.toString(), {
            user: user,
            token: token,
            isActive: true,
            loginTime: new Date().toISOString()
        });
        
        res.json({
            success: true,
            token: token,
            user: {
                id: user._id.toString(),
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
        const userId = req.user._id.toString();
        
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
            id: req.user._id.toString(),
            name: req.user.name,
            username: req.user.username,
            role: req.user.role
        }
    });
});

// 🆕 User WhatsApp Status Route
app.get('/api/user-whatsapp-status', authenticateUser, (req, res) => {
    try {
        const userId = req.user._id.toString();
        const userSession = getUserWhatsAppSession(userId);
        
        if (!userSession) {
            return res.json({
                connected: false,
                status: 'disconnected',
                message: 'جارٍ تهيئة واتساب...'
            });
        }
        
        res.json({
            connected: userSession.status === 'connected',
            status: userSession.status,
            message: userSession.status === 'connected' ? 'واتساب متصل ✅' : 
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
        const userId = req.user._id.toString();
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
        const userId = req.user._id.toString();
        
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
        const userId = req.user._id.toString();
        manualReconnectUserWhatsApp(userId);
        res.json({ success: true, message: 'جارٍ إعادة الاتصال...' });
    } catch (error) {
        res.status(500).json({ error: 'فشل إعادة الاتصال' });
    }
});

// NEW: User Management Routes (Admin only) - Updated for MongoDB
app.get('/api/users', authenticateUser, authorizeAdmin, async (req, res) => {
    try {
        const usersList = await db.collection('users')
            .find({})
            .project({ password: 0 })
            .toArray();
        
        res.json({ success: true, users: usersList });
    } catch (error) {
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

app.post('/api/users', authenticateUser, authorizeAdmin, async (req, res) => {
    try {
        const { name, username, password, role } = req.body;
        
        if (!name || !username || !password) {
            return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
        }
        
        // Check if username already exists
        const existingUser = await db.collection('users').findOne({ username: username });
        if (existingUser) {
            return res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
        }
        
        const newUser = {
            name: name,
            username: username,
            password: bcrypt.hashSync(password, 10),
            role: role || 'standard',
            isActive: true,
            createdAt: new Date(),
            lastLogin: null
        };
        
        const result = await db.collection('users').insertOne(newUser);
        
        // Initialize performance tracking for new user
        await initializeUserPerformance(result.insertedId.toString());
        
        res.json({
            success: true,
            user: {
                id: result.insertedId.toString(),
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

app.put('/api/users/:id', authenticateUser, authorizeAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const { name, username, password, role, isActive } = req.body;
        
        // Check if user exists
        const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
        if (!user) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }
        
        // Check if username already exists (excluding current user)
        if (username) {
            const existingUser = await db.collection('users').findOne({ 
                username: username, 
                _id: { $ne: new ObjectId(userId) } 
            });
            if (existingUser) {
                return res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
            }
        }
        
        // Prepare update data
        const updateData = {};
        if (name) updateData.name = name;
        if (username) updateData.username = username;
        if (password) updateData.password = bcrypt.hashSync(password, 10);
        if (role) updateData.role = role;
        if (isActive !== undefined) updateData.isActive = isActive;
        
        await db.collection('users').updateOne(
            { _id: new ObjectId(userId) },
            { $set: updateData }
        );
        
        res.json({
            success: true,
            message: 'تم تحديث المستخدم بنجاح'
        });
        
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Upload Excel file - Updated for MongoDB
app.post('/api/upload-excel', authenticateUser, upload.single('excelFile'), async (req, res) => {
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

        // 🆕 Add clients to user's imported list and save to MongoDB
        const userId = req.user._id.toString();
        const userSession = getUserWhatsAppSession(userId);
        
        for (const client of clients) {
            if (userSession) {
                userSession.importedClients.add(client.phone);
            }
            await saveClient(client, userId);
        }

        fs.unlinkSync(req.file.path); // Clean up uploaded file

        // Emit to all connected clients
        const updatedClients = await getClients(userId);
        io.emit('clients_updated', updatedClients);

        res.json({ 
            success: true, 
            clients: updatedClients, 
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

// Get clients list - Updated for MongoDB
app.get('/api/clients', authenticateUser, async (req, res) => {
    try {
        const userId = req.user._id.toString();
        const clients = await getClients(userId);
        res.json({ success: true, clients: clients });
    } catch (error) {
        res.json({ success: true, clients: [] });
    }
});

// Get client messages - Updated for MongoDB
app.get('/api/client-messages/:phone', authenticateUser, async (req, res) => {
    try {
        const phone = req.params.phone;
        const messages = await getClientMessages(phone);
        res.json({ success: true, messages: messages });
    } catch (error) {
        res.json({ success: true, messages: [] });
    }
});

// Get employee performance data - Updated for MongoDB
app.get('/api/employee-performance', authenticateUser, async (req, res) => {
    try {
        const userId = req.user._id.toString();
        
        if (!employeePerformance[userId]) {
            await initializeUserPerformance(userId);
        }
        
        const performanceData = employeePerformance[userId];
        const report = await generateUserPerformanceReport(userId);
        
        res.json({ 
            success: true, 
            performance: performanceData,
            report: report
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send report to manager
app.post('/api/send-to-manager', authenticateUser, async (req, res) => {
    try {
        console.log('🔄 Sending report to manager...');
        await sendReportToManager(req.user._id.toString());
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

// Bulk send endpoint - FIXED CONNECTION CHECK
app.post('/api/send-bulk', authenticateUser, async (req, res) => {
    try {
        const { message, delay = 40, clients } = req.body;
        
        console.log('📤 Bulk send request received for', clients?.length, 'clients by user', req.user.name);

        const userId = req.user._id.toString();
        const userSession = getUserWhatsAppSession(userId);
        
        // 🛠️ FIXED: Check status instead of isConnected
        if (!userSession || userSession.status !== 'connected') {
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
        
        // Track bulk campaign for the user in MongoDB
        await trackEmployeeActivity(userId, 'bulk_campaign', { 
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
                
                // Track message sent for the user in MongoDB
                await trackEmployeeActivity(userId, 'message_sent', { 
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

                await storeClientMessage(client.phone, message, true, userId);
                
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

// Send individual message - FIXED CONNECTION CHECK
app.post('/api/send-message', authenticateUser, async (req, res) => {
    try {
        const { phone, message } = req.body;
        
        const userId = req.user._id.toString();
        const userSession = getUserWhatsAppSession(userId);
        
        // 🛠️ FIXED: Check status instead of isConnected
        if (!userSession || userSession.status !== 'connected') {
            return res.status(400).json({ error: 'واتساب غير متصل' });
        }

        if (!phone || !message) {
            return res.status(400).json({ error: 'رقم الهاتف والرسالة مطلوبان' });
        }

        const formattedPhone = formatPhoneNumber(phone);
        const phoneNumber = formattedPhone + '@c.us';
        
        await userSession.client.sendMessage(phoneNumber, message);
        
        // Track individual message for the user in MongoDB
        await trackEmployeeActivity(userId, 'message_sent', { 
            clientPhone: formattedPhone,
            message: message.substring(0, 30) 
        });
        
        await storeClientMessage(phone, message, true, userId);
        await updateClientLastMessage(phone, message, userId);
        
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
    socket.on('authenticate', async (token) => {
        try {
            const decoded = verifyToken(token);
            if (!decoded) {
                socket.emit('auth_error', { error: 'Token غير صالح' });
                return;
            }
            
            const user = await db.collection('users').findOne({ _id: new ObjectId(decoded.userId), isActive: true });
            if (!user) {
                socket.emit('auth_error', { error: 'المستخدم غير موجود' });
                return;
            }
            
            socket.userId = user._id.toString();
            console.log(`🔐 Socket authenticated for user ${user.name}`);
            
            // 🆕 CRITICAL: Send authentication success
            socket.emit('authenticated', { 
                userId: user._id.toString(), 
                username: user.username 
            });
            
            // Send user-specific initial data
            const userSession = getUserWhatsAppSession(user._id.toString());
            if (userSession) {
                socket.emit(`user_status_${user._id.toString()}`, { 
                    connected: userSession.status === 'connected', 
                    message: userSession.status === 'connected' ? 'واتساب متصل ✅' : 
                            userSession.status === 'qr-ready' ? 'يرجى مسح QR Code' :
                            'جارٍ الاتصال...',
                    status: userSession.status,
                    hasQr: !!userSession.qrCode,
                    userId: user._id.toString()
                });
                
                // 🆕 CRITICAL: If QR code already exists, send it immediately
                if (userSession.qrCode) {
                    console.log(`📱 Sending existing QR code to user ${user._id.toString()}`);
                    socket.emit(`user_qr_${user._id.toString()}`, { 
                        qrCode: userSession.qrCode,
                        userId: user._id.toString(),
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
            // 🛠️ FIXED: Check status instead of isConnected
            if (!userSession || userSession.status !== 'connected') {
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
            
            // Track individual message for the user in MongoDB
            await trackEmployeeActivity(socket.userId, 'message_sent', { 
                clientPhone: formattedPhone,
                message: message.substring(0, 30) 
            });
            
            await storeClientMessage(to, message, true, socket.userId);
            await updateClientLastMessage(to, message, socket.userId);
            
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
    console.log('🛠️  CONNECTION STATUS FIXED: Now properly checks status instead of isConnected');
    console.log('🗄️  MONGODB ATLAS: INTEGRATED ✅ - All data stored in cloud database');
});
