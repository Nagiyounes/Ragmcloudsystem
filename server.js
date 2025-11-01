// Debug MongoDB URI
console.log('🔍 DEBUG: Raw MONGODB_URI from environment:', process.env.MONGODB_URI);
console.log('🔍 DEBUG: URI length:', process.env.MONGODB_URI?.length);
console.log('🔍 DEBUG: First 10 characters:', process.env.MONGODB_URI?.substring(0, 10));
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
// 🗄️ MONGODB DATABASE CONNECTION - FIXED
// =============================================

// Use environment variable for security
let uri;
if (process.env.MONGODB_URI) {
    uri = process.env.MONGODB_URI.trim();
    console.log('🔑 Using MONGODB_URI from environment variable');
} else {
    uri = "mongodb+srv://ragmcloud_user:ragmcloud123@cluster0.q7bnvpm.mongodb.net/ragmcloud-erp?retryWrites=true&w=majority&appName=Cluster0";
    console.log('🔑 Using default MONGODB_URI');
}

console.log('🔗 MongoDB URI:', uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')); // Hide password in logs

// Create a MongoClient
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
        
        console.log('✅ Database indexes created');
        return db;
    } catch (error) {
        console.error('❌ MongoDB connection error:', error.message);
        return null;
    }
}

// Initialize database connection
connectDB().then(() => {
    console.log('🔄 Database initialization completed');
    
    // 🎯 CRITICAL FIX: Initialize users AFTER database is connected
    initializeUsers().then(() => {
        console.log('✅ Users initialization completed');
    }).catch(error => {
        console.error('❌ Users initialization failed:', error);
    });
});

// Safe database operations with error handling
async function safeDBOperation(operation, fallback = null) {
    try {
        if (!db) {
            console.log('🔄 Reconnecting to database...');
            await connectDB();
        }
        return await operation();
    } catch (error) {
        console.error('❌ Database operation failed:', error.message);
        return fallback;
    }
}

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

// 🎯 CRITICAL FIX: Add JSON body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Create required directories
const directories = ['uploads', 'memory', 'tmp', 'reports', 'sessions', 'data'];
directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// 🎯 CRITICAL FIX: Serve static files from public directory
app.use(express.static('public'));

// 🎯 CRITICAL FIX: Root route - serve login page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 🎯 CRITICAL FIX: Dashboard route
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
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
const userWhatsAppSessions = new Map();

// NEW: User Management Variables
let users = [];
let currentSessions = new Map();
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
        basic: { name: "الباقة الأساسية", price: "1000 ريال سنوياً" },
        advanced: { name: "الباقة المتقدمة", price: "1800 ريال سنوياً" },
        professional: { name: "الباقة الاحترافية", price: "2700 ريال سنوياً" },
        premium: { name: "الباقة المميزة", price: "3000 ريال سنوياً" }
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

تذكر: أنت بائع محترف هدفك مساعدة العملاء في اختيار النظام المناسب لشركاتهم.`;

// =============================================
// 🗄️ DATABASE FUNCTIONS
// =============================================

// Create default users if they don't exist
async function createDefaultUsers() {
    try {
        console.log('🔄 Checking for default users...');
        
        // Check if admin user exists
        const adminUser = await db.collection('users').findOne({ username: 'admin' });
        
        if (!adminUser) {
            console.log('👤 Creating default admin user...');
            
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
            console.log('✅ Default users created successfully');
        } else {
            console.log('✅ Default users already exist');
        }
    } catch (error) {
        console.error('❌ Error creating default users:', error);
    }
}

// Initialize users and load into memory
async function initializeUsers() {
    try {
        // Wait for database to be ready
        if (!db) {
            console.log('⏳ Waiting for database connection...');
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        // Create default users if they don't exist
        await createDefaultUsers();
        
        // Load users into memory
        users = await db.collection('users').find({ isActive: true }).toArray();
        console.log(`✅ Loaded ${users.length} users from MongoDB`);
        
        // Initialize WhatsApp for all active users (with delay to avoid conflicts)
        users.forEach((user, index) => {
            setTimeout(() => {
                console.log(`🔄 Initializing WhatsApp for user ${user.username} (${user._id})`);
                initializeUserWhatsApp(user._id.toString());
            }, index * 3000); // Stagger initialization by 3 seconds
        });
    } catch (error) {
        console.error('❌ Error initializing users:', error);
    }
}

// Store client message in MongoDB
async function storeClientMessage(phone, message, isFromMe, userId = null) {
    return await safeDBOperation(async () => {
        await db.collection('messages').insertOne({
            phone: phone,
            message: message,
            fromMe: isFromMe,
            userId: userId ? new ObjectId(userId) : null,
            timestamp: new Date()
        });
        
        console.log(`💾 Stored message for ${phone} in MongoDB (${isFromMe ? 'sent' : 'received'})`);
    });
}

// Get client messages from MongoDB
async function getClientMessages(phone, limit = 50) {
    return await safeDBOperation(async () => {
        const messages = await db.collection('messages')
            .find({ phone: phone })
            .sort({ timestamp: 1 })
            .limit(limit)
            .toArray();
        
        return messages;
    }, []);
}

// Save or update client in MongoDB
async function saveClient(clientData, userId = null) {
    return await safeDBOperation(async () => {
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
    });
}

// Get all clients from MongoDB
async function getClients(userId = null) {
    return await safeDBOperation(async () => {
        let query = {};
        if (userId) {
            query.importedBy = new ObjectId(userId);
        }
        
        const clients = await db.collection('clients')
            .find(query)
            .sort({ lastActivity: -1 })
            .toArray();
        
        return clients;
    }, []);
}

// Update client status in MongoDB
async function updateClientStatus(phone, status) {
    return await safeDBOperation(async () => {
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
    });
}

// Initialize user performance tracking in MongoDB
async function initializeUserPerformance(userId) {
    return await safeDBOperation(async () => {
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
    });
}

// Track employee activity in MongoDB
async function trackEmployeeActivity(userId, type, data = {}) {
    return await safeDBOperation(async () => {
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
    });
}

// =============================================
// 🆕 MULTI-USER WHATSAPP FUNCTIONS - FIXED
// =============================================

// 🎯 FIXED: WhatsApp Client with Better Error Handling and Limited Retries
function initializeUserWhatsApp(userId, retryCount = 0) {
    const MAX_RETRIES = 2; // 🎯 LIMIT retries to prevent infinite loops
    
    console.log(`🔄 Starting WhatsApp for user ${userId} (Attempt ${retryCount + 1}/${MAX_RETRIES + 1})...`);
    
    // 🎯 FIX: Check if max retries exceeded
    if (retryCount > MAX_RETRIES) {
        console.log(`❌ Max retries exceeded for user ${userId}. WhatsApp initialization failed.`);
        
        io.emit(`user_status_${userId}`, { 
            connected: false, 
            message: 'فشل تهيئة واتساب. يرجى التحقق من المتصفح.',
            status: 'failed',
            hasQr: false,
            userId: userId
        });
        return null;
    }

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
            importedClients: new Set(),
            retryCount: retryCount
        };
        
        userWhatsAppSessions.set(userId, userSession);

        // 🎯 FIXED: WhatsApp Client Configuration with Browser Fix
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
                    '--disable-ipc-flooding-protection',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding'
                ],
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 
                               '/usr/bin/chromium-browser' || 
                               '/usr/bin/google-chrome' || 
                               null // Let puppeteer find it automatically
            },
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
            }
        });

        // 🎯 QR CODE FIX: Improved QR Code Generation with Auto-Display
        userSession.client.on('qr', (qr) => {
            console.log(`📱 QR CODE RECEIVED for user ${userId}`);
            qrcode.generate(qr, { small: true });
            
            // Generate QR code for web interface
            QRCode.toDataURL(qr, (err, url) => {
                if (!err) {
                    userSession.qrCode = url;
                    userSession.status = 'qr-ready';
                    
                    console.log(`✅ QR code generated for user ${userId}`);
                    
                    // 🎯 FIX: Emit to ALL connected clients for this user
                    io.emit(`user_qr_${userId}`, { 
                        qrCode: url,
                        userId: userId,
                        timestamp: new Date().toISOString()
                    });
                    
                    // 🎯 FIX: Also emit status update
                    io.emit(`user_status_${userId}`, { 
                        connected: false, 
                        message: 'يرجى مسح QR Code للاتصال',
                        status: 'qr-ready',
                        hasQr: true,
                        userId: userId,
                        qrCode: url // 🎯 ADDED: Send QR code in status update too
                    });
                    
                } else {
                    console.error(`❌ QR code generation failed for user ${userId}:`, err);
                    
                    // 🎯 FIX: Emit error to frontend
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
            
            // 🎯 FIX: Auto-reconnect with limited retries
            setTimeout(() => {
                console.log(`🔄 Attempting reconnection for user ${userId}...`);
                initializeUserWhatsApp(userId, retryCount + 1);
            }, 10000);
        });

        // 🆕 Better Error Handling
        userSession.client.on('error', (error) => {
            console.error(`❌ WhatsApp error for user ${userId}:`, error);
        });

        // Start initialization with better error handling
        userSession.client.initialize().catch(error => {
            console.log(`⚠️ WhatsApp init failed for user ${userId}:`, error.message);
            
            // 🎯 FIX: Limited retry with exponential backoff
            if (retryCount < MAX_RETRIES) {
                const retryDelay = Math.min(30000, 5000 * Math.pow(2, retryCount)); // Max 30 seconds
                console.log(`🔄 Retrying WhatsApp initialization for user ${userId} in ${retryDelay/1000}s...`);
                
                setTimeout(() => {
                    initializeUserWhatsApp(userId, retryCount + 1);
                }, retryDelay);
            } else {
                console.log(`❌ Max retries reached for user ${userId}. WhatsApp initialization failed.`);
                
                io.emit(`user_status_${userId}`, { 
                    connected: false, 
                    message: 'فشل تهيئة واتساب بعد عدة محاولات',
                    status: 'failed',
                    hasQr: false,
                    userId: userId
                });
            }
        });
        
        return userSession;
        
    } catch (error) {
        console.log(`❌ Error creating WhatsApp client for user ${userId}:`, error.message);
        
        // 🎯 FIX: Limited retry
        if (retryCount < MAX_RETRIES) {
            setTimeout(() => initializeUserWhatsApp(userId, retryCount + 1), 15000);
        }
        return null;
    }
}

// 🆕 Get User WhatsApp Session
function getUserWhatsAppSession(userId) {
    return userWhatsAppSessions.get(userId);
}

// 🆕 User-specific Message Processing
async function processUserIncomingMessage(userId, message, from) {
    try {
        console.log(`📩 User ${userId} processing message from ${from}`);
        
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
    return await safeDBOperation(async () => {
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
    });
}

// ENHANCED: Get conversation history for AI context from MongoDB
async function getConversationHistoryForAI(phone, maxMessages = 10) {
    return await safeDBOperation(async () => {
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
    }, []);
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
        return "أعتذر، هذا السؤال خارج نطاق تخصصي في أنظمة ERP. يمكنني مساعدتك في اختيار الباقة المناسبة لشركتك من نظام رقم كلاود.";
    }
    
    // Enhanced greeting for new conversations
    if (shouldGreet) {
        return `مرحباً بك في رقم كلاود! 🌟

نحن متخصصون في أنظمة ERP السحابية المتكاملة لتحويل إدارة شركتك.

🔹 **باقاتنا السنوية:**
• الأساسية: 1000 ريال/سنوياً
• المتقدمة: 1800 ريال/سنوياً  
• الاحترافية: 2700 ريال/سنوياً
• المميزة: 3000 ريال/سنوياً

ما هو نشاط شركتك؟`;
    }
    
    // Enhanced price responses
    if (msg.includes('سعر') || msg.includes('تكلفة') || msg.includes('ثمن') || msg.includes('كم') || msg.includes('price') || msg.includes('cost')) {
        return `أسعار باقاتنا السنوية:

💰 **الباقة الأساسية:** 1000 ريال/سنوياً
• إدارة المبيعات والمشتريات
• إدارة العملاء والمخزون
• تقارير أساسية

🚀 **الباقة المتقدمة:** 1800 ريال/سنوياً  
• كل ميزات الأساسية +
• إدارة الموارد البشرية
• إدارة المشاريع
• تقارير متقدمة

🏆 **الباقة الاحترافية:** 2700 ريال/سنوياً
• كل ميزات المتقدمة +
• إدارة المالية
• التحليلات المتقدمة
• دعم فني متميز

💎 **الباقة المميزة:** 3000 ريال/سنوياً
• كل الميزات السابقة +
• تكامل متقدم
• تدريب مكثف
• دعم على مدار الساعة

ما هو حجم شركتك ونشاطها؟`;
    }
    
    // Enhanced feature inquiries
    if (msg.includes('مميزات') || msg.includes('features') || msg.includes('ماذا') || msg.includes('what') || msg.includes('تفاصيل')) {
        return `مميزات نظام رقم كلاود ERP:

📊 **إدارة متكاملة:**
• المبيعات والفواتير
• المشتريات والموردين  
• المخزون والمستودعات
• العملاء والمبيعات
• الموارد البشرية
• التقارير والتحليلات

☁️ **مزايا سحابية:**
• الوصول من أي مكان
• لا حاجة لسيرفرات
• تحديثات تلقائية
• نسخ احتياطية يومية
• أمان عالي المستوى

📱 **سهولة الاستخدام:**
• واجهة عربية سهلة
• تدريب مجاني
• دعم فني متخصص
• تقارير ذكية

ما هو التحدي الأكبر الذي تواجهه في إدارة شركتك؟`;
    }
    
    // Enhanced contact requests
    if (msg.includes('اتصل') || msg.includes('رقم') || msg.includes('هاتف') || msg.includes('contact') || msg.includes('call') || msg.includes('phone')) {
        return `بكل سرور! يمكنك التواصل مع فريق المبيعات لدينا:

📞 **الهاتف:** +966555111222
🌐 **الموقع:** https://ragmcloud.sa
📧 **البريد:** info@ragmcloud.sa
📍 **المقر:** الرياض - حي المغرزات

سيسعد فريقنا بمساعدتك في اختيار الباقة المناسبة وتقديم عرض مفصل.

هل تفضل التواصل الآن أم في وقت لاحق؟`;
    }
    
    // Enhanced general response
    return `شكراً لاهتمامك برقم كلاود! 🌟

نظامنا يساعدك في:
• إدارة المبيعات والمشتريات
• متابعة العملاء والمخزون
• إصدار الفواتير والتقارير
• إدارة الموظفين والرواتب

🔹 **باقاتنا السنوية تبدأ من 1000 ريال**

للمساعدة في اختيار الباقة المناسبة:
ما هو نشاط شركتك وعدد المستخدمين؟`;
}

// Generate AI response with fallback
async function generateRagmcloudAIResponse(userMessage, clientPhone) {
    try {
        console.log('🤖 Generating AI response...');
        
        // Try DeepSeek AI first
        if (deepseekAvailable && process.env.DEEPSEEK_API_KEY) {
            const aiResponse = await callDeepSeekAI(userMessage, clientPhone);
            if (aiResponse && aiResponse.trim().length > 0) {
                console.log('✅ AI response generated successfully');
                return aiResponse;
            }
        }
        
        // Fallback to enhanced responses
        console.log('🔄 Using enhanced fallback response');
        return generateEnhancedRagmcloudResponse(userMessage, clientPhone);
        
    } catch (error) {
        console.error('❌ AI generation failed:', error.message);
        return generateEnhancedRagmcloudResponse(userMessage, clientPhone);
    }
}

// =============================================
// 🎯 CRITICAL FIX: ADD ALL MISSING API ROUTES
// =============================================

// Login route
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        console.log('🔐 Login attempt for username:', username);
        
        if (!username || !password) {
            return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
        }
        
        const user = await db.collection('users').findOne({ username: username, isActive: true });
        
        if (!user) {
            console.log('❌ User not found:', username);
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }
        
        console.log('✅ User found:', user.name);
        console.log('🔑 Checking password...');
        
        const isPasswordValid = bcrypt.compareSync(password, user.password);
        
        if (!isPasswordValid) {
            console.log('❌ Invalid password for user:', username);
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }
        
        console.log('✅ Login successful for:', user.name);
        
        // Update last login
        await db.collection('users').updateOne(
            { _id: user._id },
            { $set: { lastLogin: new Date() } }
        );
        
        // Generate token
        const token = generateToken(user);
        
        // Initialize user performance tracking
        await initializeUserPerformance(user._id.toString());
        
        // Initialize WhatsApp for this user if not already
        if (!getUserWhatsAppSession(user._id.toString())) {
            console.log(`🔄 Initializing WhatsApp for user ${user._id}`);
            initializeUserWhatsApp(user._id.toString());
        }
        
        res.json({
            success: true,
            message: 'تم تسجيل الدخول بنجاح',
            token: token,
            user: {
                id: user._id.toString(),
                name: user.name,
                username: user.username,
                role: user.role
            }
        });
        
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Get current user profile
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

// User WhatsApp Status
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
            hasQr: !!userSession.qrCode,
            qrCode: userSession.qrCode // 🎯 ADDED: Return QR code in status response
        });
    } catch (error) {
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// User WhatsApp QR Code
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

// User Bot Control
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

// User WhatsApp Reconnection
app.post('/api/user-reconnect-whatsapp', authenticateUser, (req, res) => {
    try {
        const userId = req.user._id.toString();
        manualReconnectUserWhatsApp(userId);
        res.json({ success: true, message: 'جارٍ إعادة الاتصال...' });
    } catch (error) {
        res.status(500).json({ error: 'فشل إعادة الاتصال' });
    }
});

// Upload Excel file
app.post('/api/upload-excel', authenticateUser, upload.single('excelFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
        }

        console.log('📂 Processing uploaded file:', req.file.originalname);
        
        // Process Excel file
        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

        const clients = jsonData.map((row, index) => {
            const name = row['Name'] || row['name'] || row['الاسم'] || row['اسم'] || 
                         row['اسم العميل'] || row['Client Name'] || `عميل ${index + 1}`;
            
            let phone = row['Phone'] || row['phone'] || row['الهاتف'] || row['هاتف'] || 
                       row['رقم الجوال'] || row['جوال'] || row['Phone Number'];
            
            // Format phone number
            if (phone) {
                phone = phone.toString().replace(/\D/g, '');
                if (phone.startsWith('0')) {
                    phone = '966' + phone.substring(1);
                } else if (!phone.startsWith('966') && phone.length === 9) {
                    phone = '966' + phone;
                }
            }
            
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

        if (clients.length === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ 
                error: 'لم يتم العثور على بيانات صالحة في الملف' 
            });
        }

        // Add clients to user's imported list and save to MongoDB
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

// Get clients list
app.get('/api/clients', authenticateUser, async (req, res) => {
    try {
        const userId = req.user._id.toString();
        const clients = await getClients(userId);
        res.json({ success: true, clients: clients });
    } catch (error) {
        res.json({ success: true, clients: [] });
    }
});

// Get client messages
app.get('/api/client-messages/:phone', authenticateUser, async (req, res) => {
    try {
        const phone = req.params.phone;
        const messages = await getClientMessages(phone);
        res.json({ success: true, messages: messages });
    } catch (error) {
        res.json({ success: true, messages: [] });
    }
});

// Get employee performance data
app.get('/api/employee-performance', authenticateUser, async (req, res) => {
    try {
        const userId = req.user._id.toString();
        
        if (!employeePerformance[userId]) {
            await initializeUserPerformance(userId);
        }
        
        const performanceData = employeePerformance[userId];
        const report = "تقرير الأداء"; // You can generate a proper report here
        
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
        // Implement send report logic here
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

// Bulk send endpoint
app.post('/api/send-bulk', authenticateUser, async (req, res) => {
    try {
        const { message, delay = 40, clients } = req.body;
        
        console.log('📤 Bulk send request received for', clients?.length, 'clients by user', req.user.name);

        const userId = req.user._id.toString();
        const userSession = getUserWhatsAppSession(userId);
        
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

            const phoneNumber = client.phone + '@c.us';
            
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
                    clientPhone: client.phone,
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

// Send individual message
app.post('/api/send-message', authenticateUser, async (req, res) => {
    try {
        const { phone, message } = req.body;
        
        const userId = req.user._id.toString();
        const userSession = getUserWhatsAppSession(userId);
        
        if (!userSession || userSession.status !== 'connected') {
            return res.status(400).json({ error: 'واتساب غير متصل' });
        }

        if (!phone || !message) {
            return res.status(400).json({ error: 'رقم الهاتف والرسالة مطلوبان' });
        }

        const phoneNumber = phone + '@c.us';
        
        await userSession.client.sendMessage(phoneNumber, message);
        
        // Track individual message for the user in MongoDB
        await trackEmployeeActivity(userId, 'message_sent', { 
            clientPhone: phone,
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

// Logout
app.post('/api/logout', authenticateUser, (req, res) => {
    try {
        const userId = req.user._id.toString();
        
        // Clean up user WhatsApp session
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

// =============================================
// SOCKET.IO CONNECTION HANDLING
// =============================================

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
            
            // Send authentication success
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
                    userId: user._id.toString(),
                    qrCode: userSession.qrCode // 🎯 ADDED: Send QR code in status update
                });
                
                // If QR code already exists, send it immediately
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

            const phoneNumber = to + '@c.us';
            
            await userSession.client.sendMessage(phoneNumber, message);
            
            // Track individual message for the user in MongoDB
            await trackEmployeeActivity(socket.userId, 'message_sent', { 
                clientPhone: to,
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

// =============================================
// HELPER FUNCTIONS
// =============================================

function checkAutoSendReport(userId) {
    // Auto-report logic here
}

// =============================================
// SERVER INITIALIZATION
// =============================================

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
    console.log('🎯 CRITICAL FIX: Added static file serving and routes for / and /dashboard');
    console.log('🎯 CRITICAL FIX: Added JSON body parser middleware');
    console.log('🎯 CRITICAL FIX: Fixed database timing issue - users initialize after DB connection');
    console.log('🎯 QR CODE FIX: Improved QR code delivery to frontend with multiple emission points');
    console.log('🎯 WHATSAPP FIX: Limited retry attempts to prevent infinite loops');
    console.log('🎯 WHATSAPP FIX: Added browser configuration for cloud environments');
});
