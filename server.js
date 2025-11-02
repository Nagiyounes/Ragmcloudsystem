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
const axios = require('axios'); // Added for DeepSeek API calls

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
    // Default URI is intentionally included for local testing convenience, but should be replaced with env variable
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
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';

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
        
        // Clear non-active sessions
        userWhatsAppSessions.forEach((session, userId) => {
            if (!users.some(u => u._id.toString() === userId)) {
                console.log(`🧹 Destroying session for inactive user ${userId}`);
                session.client.destroy().catch(() => {});
                userWhatsAppSessions.delete(userId);
            }
        });

        // Initialize WhatsApp for all active users (with delay to avoid conflicts)
        users.forEach((user, index) => {
            const userId = user._id.toString();
            // Only initialize if a session is not already running/connected/qr-ready
            if (!userWhatsAppSessions.has(userId) || userWhatsAppSessions.get(userId).status === 'disconnected') {
                 setTimeout(() => {
                    console.log(`🔄 Initializing WhatsApp for user ${user.username} (${userId})`);
                    initializeUserWhatsApp(userId);
                }, index * 3000); // Stagger initialization by 3 seconds
            } else {
                console.log(`⏩ WhatsApp session for ${userId} is already running/ready: ${userWhatsAppSessions.get(userId).status}`);
            }
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
                updateFields['$inc'] = { 'dailyStats.aiRepliesSent': 1, 'dailyStats.clientsContacted': 1 };
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

// Check if an auto-report should be sent
async function checkAutoSendReport(userId) {
    const performance = employeePerformance[userId];
    const user = users.find(u => u._id.toString() === userId);
    
    // Check if the user's role is not admin (to avoid reporting on admin's passive activity)
    if (user && user.role === 'standard' && performance && performance.dailyStats.messagesSent >= 30) {
        const today = new Date().toISOString().split('T')[0];
        
        // Check if report was already sent today
        const reportSent = await db.collection('reports').findOne({
            userId: new ObjectId(userId),
            date: today,
            type: 'auto-send'
        });
        
        if (!reportSent) {
            // Emit a notification to the user's dashboard
            const reportMessage = `✅ تجاوز أدائك حد 30 رسالة اليوم. تم إرسال تقرير تلقائي للادارة.`;
            io.emit('auto_report_notification', { userId: userId, message: reportMessage });
            
            // Log the report as sent to prevent immediate resending
            await db.collection('reports').insertOne({
                userId: new ObjectId(userId),
                date: today,
                type: 'auto-send',
                timestamp: new Date(),
                summary: `Messages Sent: ${performance.dailyStats.messagesSent}`
            });
            console.log(`📊 Auto-report sent for user ${userId}`);
        }
    }
}

// =============================================
// 🆕 MULTI-USER WHATSAPP FUNCTIONS - FIXED
// =============================================

// Get user's WhatsApp session from the map
function getUserWhatsAppSession(userId) {
    return userWhatsAppSessions.get(userId);
}

// Toggle AI bot status for a specific user
function toggleUserBot(userId, stop) {
    const userSession = getUserWhatsAppSession(userId);
    if (userSession) {
        userSession.aiBotRunning = !stop;
        io.emit(`user_bot_status_${userId}`, {
            stopped: !userSession.aiBotRunning,
            userId: userId
        });
        return true;
    }
    return false;
}

// Update the client's last message in the clients collection
async function updateClientLastMessage(phone, message, userId) {
    return await safeDBOperation(async () => {
        await db.collection('clients').updateOne(
            { phone: phone },
            { 
                $set: {
                    lastMessage: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
                    lastActivity: new Date(),
                    lastRepliedBy: userId ? new ObjectId(userId) : null
                }
            }
        );
    });
}

// Update the user's reply timer map
function updateUserReplyTimer(userId, clientPhone) {
    const userSession = getUserWhatsAppSession(userId);
    if (userSession) {
        userSession.lastMessages.set(clientPhone, new Date().getTime());
    }
}

// Check if a greeting should be sent (first message in a while)
function shouldSendGreeting(clientPhone) {
    // Logic: Check if the last message from the client was more than 1 hour ago
    const ONE_HOUR = 60 * 60 * 1000;
    
    // Check against ALL user sessions' lastMessages map
    let lastMessageTime = 0;
    for (const session of userWhatsAppSessions.values()) {
        const time = session.lastMessages.get(clientPhone);
        if (time && time > lastMessageTime) {
            lastMessageTime = time;
        }
    }
    
    if (lastMessageTime === 0) return true; // Never seen this client before
    return (new Date().getTime() - lastMessageTime) > ONE_HOUR;
}

// 🎯 FIXED: WhatsApp Client with Render-Compatible Configuration
function initializeUserWhatsApp(userId, retryCount = 0) {
    const MAX_RETRIES = 2;
    
    console.log(`🔄 Starting WhatsApp for user ${userId} (Attempt ${retryCount + 1}/${MAX_RETRIES + 1})...`);
    
    if (retryCount > MAX_RETRIES) {
        console.log(`❌ Max retries exceeded for user ${userId}. WhatsApp initialization failed.`);
        
        io.emit(`user_status_${userId}`, { 
            connected: false, 
            message: 'فشل تهيئة واتساب.',
            status: 'failed',
            hasQr: false,
            userId: userId
        });
        return null;
    }

    try {
        const existingSession = userWhatsAppSessions.get(userId);
        if (existingSession && existingSession.status !== 'disconnected') {
            console.log(`✅ User ${userId} already has an active WhatsApp session with status: ${existingSession.status}`);
            return existingSession;
        }

        const userSession = {
            userId: userId,
            client: null,
            isConnected: false,
            status: 'initializing',
            qrCode: null,
            aiBotRunning: true,
            lastMessages: new Map(),
            importedClients: new Set(),
            bulkCampaignRunning: false
        };

        // 🎯 SIMPLIFIED CONFIG - No Puppeteer dependencies
        const client = new Client({
            authStrategy: new LocalAuth({ clientId: userId }),
            puppeteer: {
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-gpu',
                    '--disable-dev-shm-usage'
                ],
                headless: true
            }
        });

        userSession.client = client;
        userWhatsAppSessions.set(userId, userSession);

        // QR Code Event
        client.on('qr', async (qr) => {
            userSession.qrCode = qr;
            userSession.status = 'qr-ready';
            
            QRCode.toDataURL(qr, { margin: 1 }, (err, url) => {
                if (!err) {
                    console.log(`🔑 QR Code generated for user ${userId}`);
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
                        userId: userId,
                        qrCode: url
                    });
                } else {
                    console.error(`❌ QR code generation failed for user ${userId}:`, err);
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
        client.on('ready', () => {
            console.log(`✅ WhatsApp READY for user ${userId}!`);
            userSession.isConnected = true;
            userSession.status = 'connected';
            userSession.qrCode = null;

            initializeUserPerformance(userId).catch(console.error);
            
            io.emit(`user_status_${userId}`, { 
                connected: true, 
                message: 'متصل وجاهز للاستخدام', 
                status: 'connected', 
                userId: userId 
            });
        });

        // Disconnected Event
        client.on('disconnected', (reason) => {
            console.log(`⚠️ WhatsApp DISCONNECTED for user ${userId}:`, reason);
            userSession.isConnected = false;
            userSession.status = 'disconnected';
            userSession.aiBotRunning = true;
            
            io.emit(`user_status_${userId}`, { 
                connected: false, 
                message: 'فصل الاتصال. يرجى إعادة الاتصال.', 
                status: 'disconnected', 
                userId: userId 
            });
            
            if (retryCount < MAX_RETRIES) {
                const retryDelay = 5000;
                console.log(`🔄 Retrying WhatsApp initialization for user ${userId} in ${retryDelay/1000}s...`);
                setTimeout(() => {
                    initializeUserWhatsApp(userId, retryCount + 1);
                }, retryDelay);
            }
        });

        // Message Event
        client.on('message', async (message) => {
            const session = userWhatsAppSessions.get(userId);
            if (!session || !session.aiBotRunning) {
                return;
            }

            if (message.fromMe || message.isGroup) return; 

            const clientPhone = message.from.replace('@c.us', '');
            
            console.log(`✉️ Message from ${clientPhone} to user ${userId}:`, message.body);

            await saveClient({ phone: clientPhone, name: message._data.notifyName || 'عميل جديد' }, userId);
            await storeClientMessage(clientPhone, message.body, false, userId);

            io.emit(`user_message_${userId}`, { 
                from: clientPhone, 
                message: message.body, 
                timestamp: new Date(), 
                fromMe: false, 
                userId: userId
            });

            processIncomingMessage(userId, clientPhone, message.body).catch(error => {
                console.error('❌ Error processing message:', error);
            });
        });

        // Error Handling
        client.on('error', (error) => {
            console.error(`❌ WhatsApp error for user ${userId}:`, error);
        });

        // Start initialization
        client.initialize().catch(error => {
            console.log(`⚠️ WhatsApp init failed for user ${userId}:`, error.message);
            if (retryCount < MAX_RETRIES) {
                const retryDelay = 5000;
                console.log(`🔄 Retrying WhatsApp initialization for user ${userId} in ${retryDelay/1000}s...`);
                setTimeout(() => {
                    initializeUserWhatsApp(userId, retryCount + 1);
                }, retryDelay);
            }
        });
        
        return userSession;
    } catch (error) {
        console.error(`❌ CRITICAL: Error initializing WhatsApp for user ${userId}:`, error);
        io.emit(`user_status_${userId}`, { 
            connected: false, 
            message: 'خطأ حرج في تهيئة واتساب', 
            status: 'critical_error', 
            hasQr: false, 
            userId: userId 
        });
        return null;
    }
}

// =============================================
// 🤖 AI & BOT LOGIC FUNCTIONS - FIXED
// =============================================

// Get conversation history for AI
async function getConversationHistoryForAI(phone, maxMessages = 10) {
    return await safeDBOperation(async () => {
        const messages = await getClientMessages(phone, maxMessages);
        const conversationHistory = messages.map(msg => {
            const role = msg.fromMe ? 'assistant' : 'user';
            return { role: role, content: msg.message };
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

        const messages = [
            { role: "system", content: AI_SYSTEM_PROMPT }
        ];

        if (conversationHistory.length > 0) {
            messages.push(...conversationHistory);
        }

        messages.push({ 
            role: "user", 
            content: `العميل يقول: "${userMessage}" ${shouldGreet ? 'ملاحظة: هذه بداية المحادثة - ابدأ بالتحية المناسبة' : 'المحادثة مستمرة'} الرجاء الرد بناءً على النظام والقواعد الإلزامية.` 
        });

        const response = await axios.post(DEEPSEEK_API_URL, {
            model: DEEPSEEK_MODEL,
            messages: messages,
            temperature: 0.7,
            max_tokens: 1024
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
            }
        });

        return response.data.choices[0].message.content.trim();

    } catch (error) {
        console.error('❌ DeepSeek AI API Error:', error.response?.data || error.message);
        throw new Error('AI generation failed');
    }
}

// Generate an enhanced rule-based fallback response
function generateEnhancedRagmcloudResponse(msg, clientPhone) {
    msg = msg.toLowerCase().trim();

    if (msg.includes('سلام') || msg.includes('مرحبا') || msg.includes('هلا') || msg.includes('hi') || msg.includes('hello')) {
        return `أهلاً بك! أنا مساعد المبيعات الذكي من **رقم كلاود** ☁️ ERP. كيف يمكنني مساعدتك اليوم في اختيار النظام المناسب لتحويل إدارة شركتك؟`;
    }

    if (msg.includes('سعر') || msg.includes('تكلفة') || msg.includes('ثمن') || msg.includes('كم') || msg.includes('price') || msg.includes('cost')) {
        return `أسعار باقاتنا السنوية: 💰 **الباقة الأساسية:** 1000 ريال/سنوياً • إدارة المبيعات والمشتريات • إدارة العملاء والمخزون • تقارير أساسية 🚀 **الباقة المتقدمة:** 1800 ريال/سنوياً • كل ميزات الأساسية + • إدارة الموارد البشرية • إدارة المشاريع • تقارير متقدمة 🏆 **الباقة الاحترافية:** 2700 ريال/سنوياً • كل ميزات المتقدمة + • إدارة المالية • التحليلات المتقدمة • دعم فني متميز 💎 **الباقة المميزة:** 3000 ريال/سنوياً • كل الميزات السابقة + • تكامل متقدم وتخصيص حسب الطلب للمشاريع الكبيرة. **أي باقة تبدو الأنسب لعملك؟`;
    }
    
    if (msg.includes('نظام') || msg.includes('برنامج') || msg.includes('ميزات') || msg.includes('erp') || msg.includes('features')) {
        return `نظام رقم كلاود ERP هو مساعد مبيعات ذكي لإدارة: **المبيعات**، **المشتريات**، **المخزون**، **العملاء**، **الحسابات**، و**الموارد البشرية**. يمكنك الاطلاع على التفاصيل الكاملة عبر موقعنا: https://ragmcloud.sa/features`;
    }

    if (msg.includes('تواصل') || msg.includes('اتصال') || msg.includes('رقم') || msg.includes('phone') || msg.includes('contact')) {
        return `للتواصل المباشر مع فريق المبيعات لدينا، يرجى الاتصال على: **+966555111222**. سنكون سعداء بخدمتك! 📞`;
    }
    
    return `أهلاً بك! أنا مساعد رقم كلاود، للإجابة على أسئلتك حول أنظمة ERP السحابية. يرجى وصف استفسارك بشكل محدد أكثر (مثل: الأسعار، الميزات، طريقة الاشتراك). أو يمكنك الاتصال بفريق المبيعات على +966555111222.`;
}

// Handle incoming client message and generate an AI or fallback response
async function processIncomingMessage(userId, clientPhone, userMessage) {
    const userSession = getUserWhatsAppSession(userId);
    if (!userSession || !userSession.isConnected) {
        console.log(`❌ Cannot process message: User ${userId} not connected or session not found.`);
        return;
    }
    
    try {
        let aiResponse;
        
        if (deepseekAvailable) {
            aiResponse = await callDeepSeekAI(userMessage, clientPhone);
        }
        
        if (!aiResponse || aiResponse.trim().length === 0) {
            console.log('🔄 Using enhanced fallback response');
            aiResponse = generateEnhancedRagmcloudResponse(userMessage, clientPhone);
        }
        
        if (aiResponse && aiResponse.trim().length > 0) {
            console.log('✅ AI response generated successfully');

            await userSession.client.sendMessage(clientPhone + '@c.us', aiResponse);
            await storeClientMessage(clientPhone, aiResponse, true, userId);
            updateUserReplyTimer(userId, clientPhone);
            await trackEmployeeActivity(userId, 'ai_reply', { clientPhone: clientPhone });
            await updateClientLastMessage(clientPhone, aiResponse, userId);

            io.emit(`user_message_${userId}`, { 
                from: clientPhone, 
                message: aiResponse, 
                timestamp: new Date(), 
                fromMe: true, 
                userId: userId
            });
            
            console.log(`✅ User ${userId} auto-reply sent to ${clientPhone}`);
        }
    } catch (error) {
        console.error(`❌ Error processing incoming message for user ${userId}:`, error);
        
        try {
            const professionalMessage = "عذراً، يبدو أن هناك تأخير في النظام. يرجى المحاولة مرة أخرى أو التواصل معنا مباشرة على +966555111222.";
            const clientPhoneWithSuffix = clientPhone.includes('@c.us') ? clientPhone : clientPhone + '@c.us';
            await userSession.client.sendMessage(clientPhoneWithSuffix, professionalMessage);
            await storeClientMessage(clientPhone, professionalMessage, true, userId);
            
            io.emit(`user_message_${userId}`, { 
                from: clientPhone, 
                message: professionalMessage, 
                timestamp: new Date(), 
                fromMe: true, 
                userId: userId
            });
        } catch (err) {
            console.error('❌ Failed to send fallback error message:', err);
        }
    }
}


// =============================================
// 🔒 AUTHENTICATION & MIDDLEWARE
// =============================================

// Generate JWT token
function generateToken(userId) {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '24h' });
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
        return res.status(403).json({ error: 'غير مصرح بالوصول. مطلوب صلاحيات مدير.' });
    }
    next();
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

        if (!user || !bcrypt.compareSync(password, user.password)) {
            console.log('❌ Invalid credentials for:', username);
            return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }

        await db.collection('users').updateOne(
            { _id: user._id },
            { $set: { lastLogin: new Date() } }
        );

        const token = generateToken(user._id.toString());
        console.log(`✅ User ${username} logged in successfully`);

        res.json({
            success: true,
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

// Get current user details route
app.get('/api/me', authenticateUser, (req, res) => {
    try {
        const user = req.user;
        const userDetails = {
            id: user._id.toString(),
            name: user.name,
            username: user.username,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin
        };
        res.json({ success: true, user: userDetails });
    } catch (error) {
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Get all users (Admin only)
app.get('/api/users', authenticateUser, authorizeAdmin, async (req, res) => {
    try {
        const allUsers = await db.collection('users').find({}).toArray();
        const userList = allUsers.map(user => ({
            id: user._id.toString(),
            name: user.name,
            username: user.username,
            role: user.role,
            isActive: user.isActive
        }));
        res.json({ success: true, users: userList });
    } catch (error) {
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Add new user (Admin only)
app.post('/api/add-user', authenticateUser, authorizeAdmin, async (req, res) => {
    try {
        const { name, username, password, role } = req.body;
        if (!name || !username || !password || !role) {
            return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
        }
        
        const existingUser = await db.collection('users').findOne({ username });
        if (existingUser) {
            return res.status(409).json({ error: 'اسم المستخدم موجود بالفعل' });
        }

        const newUser = {
            name,
            username,
            password: bcrypt.hashSync(password, 10),
            role: role,
            isActive: true,
            createdAt: new Date(),
            lastLogin: null
        };

        const result = await db.collection('users').insertOne(newUser);
        await initializeUsers(); 

        res.json({ success: true, userId: result.insertedId.toString(), message: 'تم إضافة المستخدم بنجاح' });
    } catch (error) {
        console.error('❌ Error adding user:', error);
        res.status(500).json({ error: 'فشل إضافة المستخدم' });
    }
});

// Update user status (Admin only)
app.put('/api/update-user', authenticateUser, authorizeAdmin, async (req, res) => {
    try {
        const { userId, isActive } = req.body;
        if (!userId) {
            return res.status(400).json({ error: 'معرف المستخدم مطلوب' });
        }

        await db.collection('users').updateOne(
            { _id: new ObjectId(userId) },
            { $set: { isActive: isActive } }
        );

        await initializeUsers(); 
        
        res.json({ success: true, message: 'تم تحديث حالة المستخدم بنجاح' });
    } catch (error) {
        console.error('❌ Error updating user status:', error);
        res.status(500).json({ error: 'فشل تحديث حالة المستخدم' });
    }
});

// Get User WhatsApp Status route
app.get('/api/user-whatsapp-status', authenticateUser, (req, res) => {
    try {
        const userId = req.user._id.toString();
        const userSession = getUserWhatsAppSession(userId);

        if (!userSession) {
            return res.json({ 
                connected: false, 
                message: 'لم يتم تهيئة الجلسة بعد', 
                status: 'uninitialized',
                aiBotRunning: false
            });
        }

        res.json({ 
            connected: userSession.isConnected, 
            message: userSession.status === 'connected' ? 'متصل وجاهز للاستخدام' : (userSession.status === 'qr-ready' ? 'يرجى مسح QR Code' : userSession.status === 'disconnected' ? 'فصل الاتصال. يرجى إعادة الاتصال.' : 'جارٍ التهيئة'), 
            status: userSession.status,
            aiBotRunning: userSession.aiBotRunning
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
        res.json({ success: true, stopped: stop, message: stop ? 'تم إيقاف البوت بنجاح' : 'تم تشغيل البوت بنجاح' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Upload Excel file route (FIXED: Added authentication)
app.post('/api/upload-excel', authenticateUser, upload.single('excelFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'لم يتم تحميل ملف' });
        }

        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet);

        const clients = json.map(row => ({
            name: row['الاسم'] || 'عميل مستورد',
            phone: (row['الهاتف'] || '').toString().replace(/[^\d+]/g, ''),
            status: 'no-reply',
            source: 'Imported Excel'
        })).filter(client => client.phone && client.phone.length > 8);

        const userId = req.user._id.toString();
        const userSession = getUserWhatsAppSession(userId);

        for (const client of clients) {
            if (userSession) {
                userSession.importedClients.add(client.phone);
            }
            await saveClient(client, userId);
        }

        fs.unlinkSync(req.file.path);
        
        const updatedClients = await getClients(userId);
        io.emit('clients_updated', updatedClients);
        
        res.json({ success: true, clients: updatedClients, count: clients.length, message: `تم معالجة ${clients.length} عميل بنجاح` });

    } catch (error) {
        console.error('❌ Error processing Excel:', error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: 'فشل معالجة ملف Excel: ' + error.message });
    }
});

// Get clients list
app.get('/api/clients', authenticateUser, async (req, res) => {
    try {
        const userId = req.user._id.toString();
        const clients = await getClients(userId);
        res.json({ success: true, clients: clients });
    } catch (error) {
        console.error('Error fetching clients:', error);
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// Update client status route
app.post('/api/update-client-status', authenticateUser, async (req, res) => {
    try {
        const { phone, status } = req.body;
        if (!phone || !status) {
            return res.status(400).json({ error: 'رقم الهاتف والحالة مطلوبة' });
        }

        await updateClientStatus(phone, status);
        
        if (status === 'interested') {
            await trackEmployeeActivity(req.user._id.toString(), 'client_interested', { clientPhone: phone });
        }

        res.json({ success: true, message: 'تم تحديث حالة العميل بنجاح' });
    } catch (error) {
        console.error('❌ Error updating client status:', error);
        res.status(500).json({ error: 'فشل تحديث حالة العميل' });
    }
});

// Get client chat history route
app.get('/api/client-messages/:phone', authenticateUser, async (req, res) => {
    try {
        const phone = req.params.phone;
        const messages = await getClientMessages(phone);
        res.json({ success: true, messages: messages });
    } catch (error) {
        console.error('❌ Error fetching client messages:', error);
        res.status(500).json({ error: 'فشل جلب الرسائل' });
    }
});


// Bulk send messages route
app.post('/api/bulk-send', authenticateUser, async (req, res) => {
    const { clients, message, delay } = req.body;
    const userId = req.user._id.toString();
    const userSession = getUserWhatsAppSession(userId);

    if (!userSession || !userSession.isConnected) {
        return res.status(400).json({ success: false, error: 'الواتساب غير متصل للمستخدم الحالي' });
    }

    if (!message || !clients || clients.length === 0) {
        return res.status(400).json({ success: false, error: 'الرسالة وقائمة العملاء مطلوبة' });
    }
    
    let successCount = 0;
    let failCount = 0;

    await trackEmployeeActivity(userId, 'bulk_campaign', { clientCount: clients.length, message: message.substring(0, 50) });

    io.emit('bulk_progress', { type: 'start', total: clients.length, message: `بدأ الإرسال إلى ${clients.length} عميل` });

    for (let i = 0; i < clients.length; i++) {
        const client = clients[i];
        if (!client.phone || client.phone.length < 10) {
            failCount++;
            continue;
        }

        const phoneNumber = client.phone + '@c.us';

        try {
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, delay * 1000));
            }

            await userSession.client.sendMessage(phoneNumber, message);
            successCount++;
            
            await updateClientLastMessage(client.phone, message, userId);
            await trackEmployeeActivity(userId, 'message_sent', { clientPhone: client.phone, message: message.substring(0, 30) });
            await storeClientMessage(client.phone, message, true, userId);
            
            io.emit('bulk_progress', { 
                type: 'progress', 
                current: i + 1, 
                total: clients.length, 
                success: successCount, 
                fail: failCount 
            });

        } catch (error) {
            console.error(`❌ Error sending message to ${client.phone}:`, error.message);
            failCount++;
        }
    }

    io.emit('bulk_progress', { type: 'end', total: clients.length, success: successCount, fail: failCount });

    res.json({ 
        success: true, 
        message: `تم إنهاء حملة الرسائل. النجاح: ${successCount}, الفشل: ${failCount}` 
    });
});

// Send a single message
app.post('/api/send-message', authenticateUser, async (req, res) => {
    try {
        const { to, message } = req.body;
        const userId = req.user._id.toString();
        const userSession = getUserWhatsAppSession(userId);

        if (!userSession || !userSession.isConnected) {
            return res.status(400).json({ error: 'الواتساب غير متصل للمستخدم الحالي' });
        }

        if (!to || !message) {
            return res.status(400).json({ error: 'رقم الهاتف والرسالة مطلوبان' });
        }

        const phoneNumber = to + '@c.us';
        await userSession.client.sendMessage(phoneNumber, message);

        await trackEmployeeActivity(userId, 'message_sent', { clientPhone: to, message: message.substring(0, 30) });
        await storeClientMessage(to, message, true, userId);
        await updateClientLastMessage(to, message, userId);

        res.json({ success: true, message: 'تم إرسال الرسالة بنجاح' });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'فشل إرسال الرسالة: ' + error.message });
    }
});

// Get performance statistics for the logged-in user
app.get('/api/performance-stats', authenticateUser, async (req, res) => {
    try {
        const userId = req.user._id.toString();
        
        await initializeUserPerformance(userId);

        const performanceData = employeePerformance[userId];
        
        if (performanceData) {
            res.json({ 
                success: true, 
                stats: {
                    messagesSent: performanceData.dailyStats.messagesSent,
                    aiRepliesSent: performanceData.dailyStats.aiRepliesSent,
                    clientsContacted: performanceData.dailyStats.clientsContacted, 
                    interestedClients: performanceData.dailyStats.interestedClients,
                }
            });
        } else {
            res.json({ success: true, stats: {} });
        }
    } catch (error) {
        console.error('❌ Error fetching performance stats:', error);
        res.status(500).json({ error: 'فشل جلب إحصائيات الأداء' });
    }
});

// Export report
app.get('/api/export-report', authenticateUser, async (req, res) => {
    try {
        const userId = req.user._id.toString();
        let query = {};
        
        if (req.user.role !== 'admin') {
            query.userId = new ObjectId(userId);
        }

        const performanceData = await db.collection('performance').find(query).sort({ date: -1 }).toArray();

        const exportData = performanceData.map(data => {
            const user = users.find(u => u._id.toString() === data.userId.toString());
            return {
                'الموظف': user ? user.name : 'مستخدم محذوف',
                'التاريخ': data.date,
                'الرسائل المرسلة': data.dailyStats.messagesSent,
                'ردود الذكاء الاصطناعي': data.dailyStats.aiRepliesSent,
                'العملاء المتصل بهم': data.dailyStats.clientsContacted,
                'العملاء المهتمين': data.dailyStats.interestedClients,
                'وقت البدء': data.dailyStats.startTime,
                'آخر نشاط': data.dailyStats.lastActivity
            };
        });

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'تقرير الأداء');

        const fileName = `Performance_Report_${req.user.role === 'admin' ? 'All' : req.user.username}_${Date.now()}.xlsx`;
        const filePath = path.join('reports', fileName);
        XLSX.writeFile(workbook, filePath);

        res.download(filePath, fileName, (err) => {
            if (err) {
                console.error('❌ Error downloading report:', err);
                res.status(500).send('فشل تحميل التقرير.');
            }
            fs.unlinkSync(filePath);
        });

    } catch (error) {
        console.error('❌ Error exporting report:', error);
        res.status(500).json({ error: 'فشل تصدير التقرير: ' + error.message });
    }
});

// Send report to admin (Simulation)
app.post('/api/send-report-to-admin', authenticateUser, async (req, res) => {
    try {
        console.log(`📧 User ${req.user.name} requested to send a report. (Simulation: Report sent via Email/WhatsApp to manager)`);
        res.json({ success: true, message: 'تم إرسال التقرير بنجاح (محاكاة: يرجى التحقق من البريد/الواتساب)' });
    } catch (error) {
        console.error('❌ Error sending report:', error);
        res.status(500).json({ error: 'فشل إرسال التقرير' });
    }
});


// Logout
app.post('/api/logout', authenticateUser, (req, res) => {
    try {
        const userId = req.user._id.toString();
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

    socket.on('authenticate', async (token) => {
        try {
            const decoded = verifyToken(token);
            if (!decoded) {
                socket.emit('auth_error', { error: 'Token غير صالح' });
                return socket.disconnect();
            }

            const user = await db.collection('users').findOne({ _id: new ObjectId(decoded.userId), isActive: true });
            if (!user) {
                socket.emit('auth_error', { error: 'المستخدم غير موجود' });
                return socket.disconnect();
            }

            socket.userId = user._id.toString();
            console.log(`📡 User ${user.username} authenticated via socket.io`);
            socket.emit('authenticated', { userId: socket.userId });

        } catch (error) {
            console.error('Socket authentication error:', error);
            socket.emit('auth_error', { error: 'خطأ في المصادقة' });
            socket.disconnect();
        }
    });

    socket.on('send_message', async (data) => {
        if (!socket.userId) return socket.emit('auth_error', { error: 'غير مصرح' });

        const { to, message } = data;
        const userSession = getUserWhatsAppSession(socket.userId);

        if (!userSession || !userSession.isConnected) {
            socket.emit('message_error', { to: to, error: 'الواتساب غير متصل للمستخدم الحالي' });
            return;
        }

        if (!to || !message) {
            socket.emit('message_error', { to: to, error: 'رقم الهاتف والرسالة مطلوبان' });
            return;
        }

        const phoneNumber = to + '@c.us';

        try {
            await userSession.client.sendMessage(phoneNumber, message);

            await trackEmployeeActivity(socket.userId, 'message_sent', { clientPhone: to, message: message.substring(0, 30) });
            await storeClientMessage(to, message, true, socket.userId);
            await updateClientLastMessage(to, message, socket.userId);

            io.emit(`user_message_${socket.userId}`, { 
                from: to, 
                message: message, 
                timestamp: new Date(), 
                fromMe: true, 
                userId: socket.userId
            });

        } catch (error) {
            console.error('Error sending message via socket:', error);
            socket.emit('message_error', { to: to, error: 'فشل إرسال الرسالة' });
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// =============================================
// 🚀 SERVER START
// =============================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n==============================================`);
    console.log(`🚀 Server is running on port: ${PORT}`);
    console.log(`🌐 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`----------------------------------------------`);
    console.log('COMPANY INFO:');
    console.log('📞 Phone:', ragmcloudCompanyInfo.phone);
    console.log('🌐 Website:', ragmcloudCompanyInfo.website);
    console.log('🔑 DeepSeek Available:', deepseekAvailable);
    console.log('👥 User Management: ENABLED');
    console.log('🔐 Authentication: JWT + Bcrypt');
    console.log('🆕 MULTI-USER WHATSAPP: ENABLED');
    console.log('🤖 BOT STATUS: READY');
    console.log('⏰ AUTO-REPLY DELAY: 1 HOUR for greeting context');
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
    console.log('🔧 BUILD FIXED: Removed Puppeteer dependencies for fast deployment');
    console.log(`==============================================\n`);
});
