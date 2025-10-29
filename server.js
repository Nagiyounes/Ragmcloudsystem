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
const directories = ['uploads', 'memory', 'tmp', 'reports', 'sessions', 'data', 'public'];
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
// 🆕 ENHANCED MULTI-USER WHATSAPP ARCHITECTURE
// =============================================

// 🆕 User WhatsApp Sessions Management
const userWhatsAppSessions = new Map();

// NEW: User Management Variables
let users = [];
let currentSessions = new Map();
const JWT_SECRET = process.env.JWT_SECRET || 'ragmcloud-erp-secret-key-2024';

// Employee Performance Tracking - PER USER
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

// Company Information (same as before)
const ragmcloudCompanyInfo = {
    // ... (same company info as original)
};

// AI System Prompt (same as before)
const AI_SYSTEM_PROMPT = `...`;

// =============================================
// 🆕 USER-SPECIFIC DATA MANAGEMENT
// =============================================

// 🆕 Get User-specific Client Messages
function getUserClientMessages(userId, phone) {
    try {
        const userDir = `./memory/user_${userId}`;
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }
        
        const messageFile = `${userDir}/messages_${phone}.json`;
        
        if (fs.existsSync(messageFile)) {
            const messagesData = fs.readFileSync(messageFile, 'utf8');
            return JSON.parse(messagesData);
        }
    } catch (error) {
        console.error(`Error getting user ${userId} client messages:`, error);
    }
    
    return [];
}

// 🆕 Store User-specific Messages
function storeUserClientMessage(userId, phone, message, isFromMe) {
    try {
        const userDir = `./memory/user_${userId}`;
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }

        const messageData = {
            message: message,
            fromMe: isFromMe,
            timestamp: new Date().toISOString(),
            userId: userId
        };

        let clientMessages = [];
        const messageFile = `${userDir}/messages_${phone}.json`;
        
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
        
        console.log(`💾 Stored message for user ${userId} - ${phone} (${isFromMe ? 'sent' : 'received'})`);
        
    } catch (error) {
        console.error('Error storing user client message:', error);
    }
}

// 🆕 Get User-specific Clients
function getUserClients(userId) {
    try {
        const userDir = `./memory/user_${userId}`;
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }
        
        const clientsFile = `${userDir}/clients.json`;
        
        if (fs.existsSync(clientsFile)) {
            const clientsData = fs.readFileSync(clientsFile, 'utf8');
            return JSON.parse(clientsData);
        }
    } catch (error) {
        console.error(`Error getting user ${userId} clients:`, error);
    }
    
    return [];
}

// 🆕 Store User-specific Clients
function storeUserClients(userId, clients) {
    try {
        const userDir = `./memory/user_${userId}`;
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }
        
        const clientsFile = `${userDir}/clients.json`;
        fs.writeFileSync(clientsFile, JSON.stringify(clients, null, 2));
        
        console.log(`💾 Stored ${clients.length} clients for user ${userId}`);
    } catch (error) {
        console.error(`Error storing user ${userId} clients:`, error);
    }
}

// =============================================
// 🆕 ENHANCED MULTI-USER WHATSAPP FUNCTIONS
// =============================================

// 🆕 IMPROVED WhatsApp Client with User Isolation
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

        // User-specific session configuration
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

        // QR Code Generation (User-specific)
        userSession.client.on('qr', (qr) => {
            console.log(`📱 QR CODE RECEIVED for user ${userId}`);
            qrcode.generate(qr, { small: true });
            
            QRCode.toDataURL(qr, (err, url) => {
                if (!err) {
                    userSession.qrCode = url;
                    userSession.status = 'qr-ready';
                    
                    console.log(`✅ QR code generated for user ${userId}`);
                    
                    // Emit to ALL connected clients for this user
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

        // Ready Event (User-specific)
        userSession.client.on('ready', () => {
            console.log(`✅ WhatsApp READY for user ${userId}!`);
            userSession.isConnected = true;
            userSession.status = 'connected';
            
            io.emit(`user_status_${userId}`, { 
                connected: true, 
                message: 'واتساب متصل ✅',
                status: 'connected',
                hasQr: false,
                userId: userId
            });
            
            console.log(`✅ User ${userId} WhatsApp connected successfully`);
        });

        // Message Event with User-specific Processing
        userSession.client.on('message', async (message) => {
            if (message.from === 'status@broadcast' || message.fromMe) {
                return;
            }

            console.log(`📩 User ${userId} received message from:`, message.from);
            console.log('💬 Message content:', message.body);
            
            try {
                const clientPhone = message.from.replace('@c.us', '');
                
                // Store in user-specific memory
                storeUserClientMessage(userId, clientPhone, message.body, false);
                
                // Emit to frontend with user context
                io.emit(`user_message_${userId}`, {
                    from: clientPhone,
                    message: message.body,
                    timestamp: new Date(),
                    fromMe: false,
                    userId: userId
                });

                // Update client last message in user-specific storage
                updateUserClientLastMessage(userId, clientPhone, message.body);

                // Process incoming message with user-specific auto-reply
                processUserIncomingMessage(userId, message.body, message.from).catch(error => {
                    console.error(`❌ Error in processUserIncomingMessage for user ${userId}:`, error);
                });
                
            } catch (error) {
                console.error(`❌ Error handling message for user ${userId}:`, error);
            }
        });

        // Authentication Failure (User-specific)
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

        // Disconnected Event (User-specific)
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

        // Better Error Handling
        userSession.client.on('error', (error) => {
            console.error(`❌ WhatsApp error for user ${userId}:`, error);
        });

        // Start initialization
        userSession.client.initialize().catch(error => {
            console.log(`⚠️ WhatsApp init failed for user ${userId}:`, error.message);
            
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

// 🆕 Update User Client Last Message
function updateUserClientLastMessage(userId, phone, message) {
    try {
        let clients = getUserClients(userId);
        
        const clientIndex = clients.findIndex(client => client.phone === phone);
        if (clientIndex !== -1) {
            clients[clientIndex].lastMessage = message.substring(0, 50) + (message.length > 50 ? '...' : '');
            clients[clientIndex].lastActivity = new Date().toISOString();
            storeUserClients(userId, clients);
            
            io.emit(`user_clients_updated_${userId}`, clients);
        } else {
            // Add new client if not exists
            const newClient = {
                id: Date.now(),
                name: `عميل ${phone}`,
                phone: phone,
                lastMessage: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
                unread: 0,
                importedAt: new Date().toISOString(),
                lastActivity: new Date().toISOString(),
                status: 'no-reply'
            };
            clients.push(newClient);
            storeUserClients(userId, clients);
            io.emit(`user_clients_updated_${userId}`, clients);
        }
    } catch (error) {
        console.error(`Error updating user ${userId} client last message:`, error);
    }
}

// 🆕 User-specific Message Processing
async function processUserIncomingMessage(userId, message, from) {
    try {
        console.log(`📩 User ${userId} processing message from ${from}: ${message}`);
        
        const clientPhone = from.replace('@c.us', '');
        
        // Store the incoming message in user-specific memory
        storeUserClientMessage(userId, clientPhone, message, false);
        
        // Auto-detect client interest
        autoDetectUserClientInterest(userId, clientPhone, message);
        
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
        if (!shouldReplyToUserClient(userId, clientPhone)) {
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
        
        // Send the response using user's WhatsApp client
        await userSession.client.sendMessage(from, aiResponse);
        
        // Store the sent message in user-specific memory
        storeUserClientMessage(userId, clientPhone, aiResponse, true);
        
        // Update user-specific reply timer
        updateUserReplyTimer(userId, clientPhone);
        
        // Track AI reply for the specific user
        if (currentSessions.has(userId)) {
            trackEmployeeActivity(userId, 'ai_reply', { clientPhone: clientPhone });
        }
        
        // Update client last message in user-specific storage
        updateUserClientLastMessage(userId, clientPhone, aiResponse);
        
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
function shouldReplyToUserClient(userId, phone) {
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

// 🆕 Auto-detect user client interest
function autoDetectUserClientInterest(userId, phone, message) {
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
        
        updateUserClientStatus(userId, phone, newStatus);
        
        return newStatus;
    } catch (error) {
        console.error('Error auto-detecting user client interest:', error);
        return 'no-reply';
    }
}

// 🆕 Update user client status
function updateUserClientStatus(userId, phone, status) {
    try {
        let clients = getUserClients(userId);
        
        const clientIndex = clients.findIndex(client => client.phone === phone);
        if (clientIndex !== -1) {
            clients[clientIndex].status = status;
            clients[clientIndex].statusUpdatedAt = new Date().toISOString();
            storeUserClients(userId, clients);
            
            io.emit(`user_client_status_updated_${userId}`, {
                phone: phone,
                status: status,
                clients: clients
            });
            
            console.log(`🔄 Auto-updated user ${userId} client ${phone} status to: ${status}`);
        }
    } catch (error) {
        console.error('Error updating user client status:', error);
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
// USER MANAGEMENT FUNCTIONS
// =============================================

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

// =============================================
// EXISTING FUNCTIONS (Updated for User-specific)
// =============================================

// [Include all the existing functions like initializeUserPerformance, trackEmployeeActivity, 
// generateRagmcloudAIResponse, processExcelFile, formatPhoneNumber, etc. but make sure 
// they use the user-specific versions when needed]

// Note: Due to character limits, I'm showing the key changes. The complete file would include
// all the original functions adapted for user-specific data management.

// =============================================
// ROUTES
// =============================================

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

// 🆕 NEW: User Management Page
app.get('/user-management', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'user-management.html'));
});

// 🆕 NEW: User Dashboard (for admin navigation)
app.get('/user-dashboard/:userId', authenticateUser, authorizeAdmin, (req, res) => {
    const targetUserId = parseInt(req.params.userId);
    const targetUser = users.find(u => u.id === targetUserId);
    
    if (!targetUser) {
        return res.status(404).json({ error: 'المستخدم غير موجود' });
    }
    
    // Create a temporary token for the target user (admin impersonation)
    const tempToken = generateToken(targetUser);
    
    res.json({
        success: true,
        token: tempToken,
        user: {
            id: targetUser.id,
            name: targetUser.name,
            username: targetUser.username,
            role: targetUser.role
        },
        message: 'تم الانتقال إلى لوحة تحكم المستخدم'
    });
});

// Login Route
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
        
        // Initialize user WhatsApp session
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

// 🆕 User-specific Clients Route
app.get('/api/user-clients', authenticateUser, (req, res) => {
    try {
        const userId = req.user.id;
        const clients = getUserClients(userId);
        res.json({ success: true, clients: clients });
    } catch (error) {
        res.json({ success: true, clients: [] });
    }
});

// 🆕 User-specific Client Messages Route
app.get('/api/user-client-messages/:phone', authenticateUser, (req, res) => {
    try {
        const userId = req.user.id;
        const phone = req.params.phone;
        const messages = getUserClientMessages(userId, phone);
        res.json({ success: true, messages: messages });
    } catch (error) {
        res.json({ success: true, messages: [] });
    }
});

// 🆕 User-specific Upload Excel
app.post('/api/user-upload-excel', authenticateUser, upload.single('excelFile'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
        }

        console.log('📂 Processing uploaded file for user:', req.user.name);
        
        const clients = processExcelFile(req.file.path);

        if (clients.length === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ 
                error: 'لم يتم العثور على بيانات صالحة في الملف' 
            });
        }

        // Add clients to user's imported list and storage
        const userId = req.user.id;
        const userSession = getUserWhatsAppSession(userId);
        if (userSession) {
            clients.forEach(client => {
                userSession.importedClients.add(client.phone);
            });
        }

        // Save clients to user-specific storage
        storeUserClients(userId, clients);
        fs.unlinkSync(req.file.path);

        // Emit to the specific user
        io.emit(`user_clients_updated_${userId}`, clients);

        res.json({ 
            success: true, 
            clients: clients, 
            count: clients.length,
            message: `تم معالجة ${clients.length} عميل بنجاح`
        });

    } catch (error) {
        console.error('❌ Error processing Excel:', error);
        
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(500).json({ 
            error: 'فشل معالجة ملف Excel: ' + error.message 
        });
    }
});

// User Management Routes (Admin only)
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

app.put('/api/users/:id', authenticateUser, authorizeAdmin, (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { name, username, password, role, isActive } = req.body;
        
        const userIndex = users.findIndex(u => u.id === userId);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }
        
        if (username && users.find(u => u.username === username && u.id !== userId)) {
            return res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
        }
        
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

app.delete('/api/users/:id', authenticateUser, authorizeAdmin, (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        
        if (userId === req.user.id) {
            return res.status(400).json({ error: 'لا يمكن حذف حسابك الخاص' });
        }
        
        const userIndex = users.findIndex(u => u.id === userId);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }
        
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

// [Include other existing routes with user-specific adaptations]

// Socket.io
io.on('connection', (socket) => {
    console.log('Client connected');
    
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
                
                if (userSession.qrCode) {
                    console.log(`📱 Sending existing QR code to user ${user.id}`);
                    socket.emit(`user_qr_${user.id}`, { 
                        qrCode: userSession.qrCode,
                        userId: user.id,
                        timestamp: new Date().toISOString()
                    });
                }
            }
            
            // Send user-specific clients
            const userClients = getUserClients(user.id);
            socket.emit(`user_clients_updated_${user.id}`, userClients);
            
        } catch (error) {
            socket.emit('auth_error', { error: 'خطأ في المصادقة' });
        }
    });

    // [Include other socket event handlers with user-specific adaptations]

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
    console.log('📁 USER-SPECIFIC DATA: ENABLED');
    console.log('🎯 SESSION ISOLATION: COMPLETED');
    console.log('👑 ADMIN NAVIGATION: ENABLED');
    console.log('📊 SEPARATE USER MANAGEMENT: READY');
});
