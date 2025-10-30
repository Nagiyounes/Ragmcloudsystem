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
        // Create default users if they don't exist
        await createDefaultUsers();
        
        // Load users into memory
        users = await db.collection('users').find({ isActive: true }).toArray();
        console.log(`✅ Loaded ${users.length} users from MongoDB`);
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
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null
            },
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
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

سيسعد فريقنا بمساعدتك في اختيار البackage المناسبة وتقديم عرض مفصل.

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
// 🆕 USER MANAGEMENT ROUTES
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
            message: 'تم تسجيل الدخول بنجاح',
            token: token,
            user: {
                id: user._id,
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
app.get('/api/profile', authenticateUser, (req, res) => {
    res.json({
        user: {
            id: req.user._id,
            name: req.user.name,
            username: req.user.username,
            role: req.user.role
        }
    });
});

// Change password
app.post('/api/change-password', authenticateUser, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'كلمة المرور الحالية والجديدة مطلوبتان' });
        }
        
        // Verify current password
        const isCurrentPasswordValid = bcrypt.compareSync(currentPassword, req.user.password);
        if (!isCurrentPasswordValid) {
            return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
        }
        
        // Hash new password
        const hashedNewPassword = bcrypt.hashSync(newPassword, 10);
        
        // Update password
        await db.collection('users').updateOne(
            { _id: req.user._id },
            { $set: { password: hashedNewPassword } }
        );
        
        res.json({ message: 'تم تغيير كلمة المرور بنجاح' });
        
    } catch (error) {
        console.error('❌ Change password error:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// =============================================
// 🆕 USER-SPECIFIC WHATSAPP ROUTES
// =============================================

// Get user WhatsApp status
app.get('/api/user/whatsapp-status', authenticateUser, (req, res) => {
    const userId = req.user._id.toString();
    const userSession = getUserWhatsAppSession(userId);
    
    if (!userSession) {
        return res.json({
            connected: false,
            message: 'جاري التهيئة...',
            status: 'initializing',
            hasQr: false,
            userId: userId
        });
    }
    
    res.json({
        connected: userSession.isConnected,
        message: userSession.isConnected ? 'واتساب متصل ✅' : 'جارٍ الاتصال...',
        status: userSession.status,
        hasQr: !!userSession.qrCode,
        qrCode: userSession.qrCode,
        userId: userId
    });
});

// Toggle user bot
app.post('/api/user/toggle-bot', authenticateUser, (req, res) => {
    const userId = req.user._id.toString();
    const { stop } = req.body;
    
    const success = toggleUserBot(userId, stop);
    
    if (success) {
        res.json({ 
            message: stop ? 'تم إيقاف الرد التلقائي' : 'تم تفعيل الرد التلقائي',
            stopped: stop 
        });
    } else {
        res.status(400).json({ error: 'فشل في تغيير حالة البوت' });
    }
});

// Reconnect user WhatsApp
app.post('/api/user/reconnect-whatsapp', authenticateUser, (req, res) => {
    const userId = req.user._id.toString();
    
    manualReconnectUserWhatsApp(userId);
    
    res.json({ message: 'جاري إعادة الاتصال...' });
});

// Get user clients
app.get('/api/user/clients', authenticateUser, async (req, res) => {
    try {
        const userId = req.user._id.toString();
        const clients = await getClients(userId);
        res.json(clients);
    } catch (error) {
        console.error('❌ Error getting user clients:', error);
        res.status(500).json({ error: 'خطأ في جلب العملاء' });
    }
});

// Import clients for user
app.post('/api/user/import-clients', authenticateUser, upload.single('file'), async (req, res) => {
    try {
        const userId = req.user._id.toString();
        
        if (!req.file) {
            return res.status(400).json({ error: 'لم يتم رفع ملف' });
        }
        
        const filePath = req.file.path;
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
        
        let importedCount = 0;
        let errorCount = 0;
        
        const userSession = getUserWhatsAppSession(userId);
        if (!userSession) {
            return res.status(400).json({ error: 'جلسة واتساب غير نشطة' });
        }
        
        for (const row of data) {
            try {
                const phone = String(row.phone || row.mobile || row.Phone || row.Mobile).trim();
                
                if (phone && phone.length >= 10) {
                    const cleanPhone = phone.replace(/\D/g, '');
                    
                    if (cleanPhone.length >= 10) {
                        const clientData = {
                            phone: cleanPhone,
                            name: row.name || row.Name || 'عميل',
                            company: row.company || row.Company || '',
                            notes: row.notes || row.Notes || '',
                            status: 'new',
                            importedAt: new Date(),
                            importedBy: new ObjectId(userId)
                        };
                        
                        await saveClient(clientData, userId);
                        userSession.importedClients.add(cleanPhone);
                        importedCount++;
                    } else {
                        errorCount++;
                    }
                } else {
                    errorCount++;
                }
            } catch (rowError) {
                console.error('Error processing row:', rowError);
                errorCount++;
            }
        }
        
        // Clean up uploaded file
        fs.unlinkSync(filePath);
        
        // Track bulk import activity
        await trackEmployeeActivity(userId, 'bulk_campaign', { count: importedCount });
        
        res.json({
            message: `تم استيراد ${importedCount} عميل بنجاح`,
            imported: importedCount,
            errors: errorCount
        });
        
    } catch (error) {
        console.error('❌ Error importing clients:', error);
        res.status(500).json({ error: 'خطأ في استيراد العملاء' });
    }
});

// Send message to client (user-specific)
app.post('/api/user/send-message', authenticateUser, async (req, res) => {
    try {
        const userId = req.user._id.toString();
        const { phone, message } = req.body;
        
        if (!phone || !message) {
            return res.status(400).json({ error: 'رقم الهاتف والرسالة مطلوبان' });
        }
        
        const userSession = getUserWhatsAppSession(userId);
        if (!userSession || !userSession.isConnected) {
            return res.status(400).json({ error: 'جلسة واتساب غير نشطة' });
        }
        
        const chatId = `${phone}@c.us`;
        
        await userSession.client.sendMessage(chatId, message);
        
        // Store sent message in MongoDB
        await storeClientMessage(phone, message, true, userId);
        
        // Track message sent activity
        await trackEmployeeActivity(userId, 'message_sent', { clientPhone: phone });
        
        res.json({ message: 'تم إرسال الرسالة بنجاح' });
        
    } catch (error) {
        console.error('❌ Error sending message:', error);
        res.status(500).json({ error: 'خطأ في إرسال الرسالة' });
    }
});

// Get user performance
app.get('/api/user/performance', authenticateUser, async (req, res) => {
    try {
        const userId = req.user._id.toString();
        const today = new Date().toISOString().split('T')[0];
        
        const performance = await db.collection('performance').findOne({ 
            userId: new ObjectId(userId), 
            date: today 
        });
        
        if (!performance) {
            // Initialize performance for today
            await initializeUserPerformance(userId);
            const newPerformance = await db.collection('performance').findOne({ 
                userId: new ObjectId(userId), 
                date: today 
            });
            return res.json(newPerformance || { dailyStats: {} });
        }
        
        res.json(performance);
        
    } catch (error) {
        console.error('❌ Error getting user performance:', error);
        res.status(500).json({ error: 'خطأ في جلب بيانات الأداء' });
    }
});

// =============================================
// ADMIN ROUTES
// =============================================

// Get all users (admin only)
app.get('/api/admin/users', authenticateUser, authorizeAdmin, async (req, res) => {
    try {
        const allUsers = await db.collection('users').find({}).toArray();
        
        // Remove passwords from response
        const usersWithoutPasswords = allUsers.map(user => ({
            id: user._id,
            name: user.name,
            username: user.username,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin
        }));
        
        res.json(usersWithoutPasswords);
        
    } catch (error) {
        console.error('❌ Error getting users:', error);
        res.status(500).json({ error: 'خطأ في جلب المستخدمين' });
    }
});

// Create new user (admin only)
app.post('/api/admin/users', authenticateUser, authorizeAdmin, async (req, res) => {
    try {
        const { name, username, password, role } = req.body;
        
        if (!name || !username || !password || !role) {
            return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
        }
        
        // Check if username already exists
        const existingUser = await db.collection('users').findOne({ username: username });
        if (existingUser) {
            return res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
        }
        
        // Hash password
        const hashedPassword = bcrypt.hashSync(password, 10);
        
        const newUser = {
            name: name,
            username: username,
            password: hashedPassword,
            role: role,
            isActive: true,
            createdAt: new Date(),
            lastLogin: null
        };
        
        await db.collection('users').insertOne(newUser);
        
        res.json({ message: 'تم إنشاء المستخدم بنجاح' });
        
    } catch (error) {
        console.error('❌ Error creating user:', error);
        res.status(500).json({ error: 'خطأ في إنشاء المستخدم' });
    }
});

// Update user (admin only)
app.put('/api/admin/users/:id', authenticateUser, authorizeAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const { name, username, password, role, isActive } = req.body;
        
        const updateData = { name, username, role, isActive };
        
        // Only update password if provided
        if (password) {
            updateData.password = bcrypt.hashSync(password, 10);
        }
        
        await db.collection('users').updateOne(
            { _id: new ObjectId(userId) },
            { $set: updateData }
        );
        
        res.json({ message: 'تم تحديث المستخدم بنجاح' });
        
    } catch (error) {
        console.error('❌ Error updating user:', error);
        res.status(500).json({ error: 'خطأ في تحديث المستخدم' });
    }
});

// Get all clients (admin only)
app.get('/api/admin/clients', authenticateUser, authorizeAdmin, async (req, res) => {
    try {
        const clients = await getClients();
        res.json(clients);
    } catch (error) {
        console.error('❌ Error getting all clients:', error);
        res.status(500).json({ error: 'خطأ في جلب العملاء' });
    }
});

// Get all performance data (admin only)
app.get('/api/admin/performance', authenticateUser, authorizeAdmin, async (req, res) => {
    try {
        const { date } = req.query;
        let query = {};
        
        if (date) {
            query.date = date;
        }
        
        const performanceData = await db.collection('performance')
            .find(query)
            .sort({ date: -1 })
            .toArray();
        
        // Populate user names
        const performanceWithUsers = await Promise.all(
            performanceData.map(async (perf) => {
                const user = await db.collection('users').findOne({ _id: perf.userId });
                return {
                    ...perf,
                    userName: user ? user.name : 'Unknown'
                };
            })
        );
        
        res.json(performanceWithUsers);
        
    } catch (error) {
        console.error('❌ Error getting performance data:', error);
        res.status(500).json({ error: 'خطأ في جلب بيانات الأداء' });
    }
});

// =============================================
// SOCKET.IO CONNECTIONS
// =============================================

io.on('connection', (socket) => {
    console.log('🔌 New client connected:', socket.id);
    
    // Handle user authentication for sockets
    socket.on('authenticate', (token) => {
        try {
            const decoded = verifyToken(token);
            if (decoded) {
                socket.userId = decoded.userId;
                console.log(`✅ Socket ${socket.id} authenticated for user ${decoded.userId}`);
                
                // Send initial user-specific data
                const userSession = getUserWhatsAppSession(decoded.userId);
                if (userSession) {
                    socket.emit(`user_status_${decoded.userId}`, {
                        connected: userSession.isConnected,
                        message: userSession.isConnected ? 'واتساب متصل ✅' : 'جارٍ الاتصال...',
                        status: userSession.status,
                        hasQr: !!userSession.qrCode,
                        userId: decoded.userId
                    });
                    
                    if (userSession.qrCode) {
                        socket.emit(`user_qr_${decoded.userId}`, {
                            qrCode: userSession.qrCode,
                            userId: decoded.userId,
                            timestamp: new Date().toISOString()
                        });
                    }
                }
            }
        } catch (error) {
            console.error('Socket authentication error:', error);
        }
    });
    
    socket.on('disconnect', () => {
        console.log('🔌 Client disconnected:', socket.id);
    });
});

// =============================================
// SERVER INITIALIZATION
// =============================================

// Initialize the application
async function initializeApp() {
    console.log('🚀 Initializing RAGMCloud ERP System...');
    
    // Wait for database connection
    let attempts = 0;
    while (!db && attempts < 10) {
        console.log(`🔄 Waiting for database connection... (${attempts + 1}/10)`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        attempts++;
    }
    
    if (!db) {
        console.error('❌ Failed to connect to database after 10 attempts');
        process.exit(1);
    }
    
    // Initialize users
    await initializeUsers();
    
    console.log('✅ RAGMCloud ERP System initialized successfully');
    console.log('📊 Available users:', users.map(u => u.username));
    
    // Initialize WhatsApp for all active users
    users.forEach(user => {
        console.log(`🔄 Initializing WhatsApp for user ${user.username} (${user._id})`);
        initializeUserWhatsApp(user._id.toString());
    });
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Access the system at: http://localhost:${PORT}`);
    
    // Initialize the application
    initializeApp().catch(console.error);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🛑 Shutting down gracefully...');
    
    // Destroy all WhatsApp sessions
    for (const [userId, session] of userWhatsAppSessions.entries()) {
        if (session.client) {
            await session.client.destroy();
        }
    }
    
    // Close database connection
    if (client) {
        await client.close();
    }
    
    process.exit(0);
});
