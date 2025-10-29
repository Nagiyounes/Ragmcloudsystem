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
// MULTI-USER WHATSAPP ARCHITECTURE
// =============================================

const userWhatsAppSessions = new Map();
let users = [];
let currentSessions = new Map();
const JWT_SECRET = process.env.JWT_SECRET || 'ragmcloud-erp-secret-key-2024';
let employeePerformance = {};
let deepseekAvailable = false;

console.log('🔑 Initializing DeepSeek AI...');
if (process.env.DEEPSEEK_API_KEY) {
    deepseekAvailable = true;
    console.log('✅ DeepSeek API key found');
} else {
    console.log('❌ DeepSeek API key not found in .env file');
    deepseekAvailable = false;
}

// Company Information
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
// USER-SPECIFIC DATA MANAGEMENT
// =============================================

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
        
        if (clientMessages.length > 50) {
            clientMessages = clientMessages.slice(-50);
        }
        
        fs.writeFileSync(messageFile, JSON.stringify(clientMessages, null, 2));
        
        console.log(`💾 Stored message for user ${userId} - ${phone} (${isFromMe ? 'sent' : 'received'})`);
        
    } catch (error) {
        console.error('Error storing user client message:', error);
    }
}

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
        console.error('Error saving performance data for user', userId, error);
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
        console.error('Error loading performance data for user', userId, error);
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

function checkAutoSendReport(userId) {
    if (!employeePerformance[userId]) return;
    
    const messageCount = employeePerformance[userId].dailyStats.messagesSent;
    
    if (messageCount > 0 && messageCount % 30 === 0) {
        console.log(`📊 Auto-sending report for user ${userId} after ${messageCount} messages...`);
        
        io.emit('auto_report_notification', {
            userId: userId,
            messageCount: messageCount,
            message: `تم إرسال ${messageCount} رسالة. جاري إرسال التقرير التلقائي إلى المدير...`
        });
        
        setTimeout(() => {
            sendReportToManager(userId).catch(error => {
                console.error('❌ Auto-report failed for user', userId, error);
            });
        }, 3000);
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
// WHATSAPP FUNCTIONS
// =============================================

function initializeUserWhatsApp(userId) {
    console.log(`🔄 Starting WhatsApp for user ${userId}...`);
    
    try {
        if (userWhatsAppSessions.has(userId) && userWhatsAppSessions.get(userId).status === 'connected') {
            console.log(`✅ User ${userId} already has an active WhatsApp session`);
            return userWhatsAppSessions.get(userId);
        }

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

        userSession.client.on('qr', (qr) => {
            console.log(`📱 QR CODE RECEIVED for user ${userId}`);
            qrcode.generate(qr, { small: true });
            
            QRCode.toDataURL(qr, (err, url) => {
                if (!err) {
                    userSession.qrCode = url;
                    userSession.status = 'qr-ready';
                    
                    console.log(`✅ QR code generated for user ${userId}`);
                    
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

        userSession.client.on('message', async (message) => {
            if (message.from === 'status@broadcast' || message.fromMe) {
                return;
            }

            console.log(`📩 User ${userId} received message from:`, message.from);
            console.log('💬 Message content:', message.body);
            
            try {
                const clientPhone = message.from.replace('@c.us', '');
                
                storeUserClientMessage(userId, clientPhone, message.body, false);
                
                io.emit(`user_message_${userId}`, {
                    from: clientPhone,
                    message: message.body,
                    timestamp: new Date(),
                    fromMe: false,
                    userId: userId
                });

                updateUserClientLastMessage(userId, clientPhone, message.body);
                processUserIncomingMessage(userId, message.body, message.from).catch(error => {
                    console.error(`❌ Error in processUserIncomingMessage for user ${userId}:`, error);
                });
                
            } catch (error) {
                console.error(`❌ Error handling message for user ${userId}:`, error);
            }
        });

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
            
            setTimeout(() => {
                console.log(`🔄 Attempting reconnection for user ${userId}...`);
                initializeUserWhatsApp(userId);
            }, 10000);
        });

        userSession.client.on('error', (error) => {
            console.error(`❌ WhatsApp error for user ${userId}:`, error);
        });

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

async function processUserIncomingMessage(userId, message, from) {
    try {
        console.log(`📩 User ${userId} processing message from ${from}: ${message}`);
        
        const clientPhone = from.replace('@c.us', '');
        
        storeUserClientMessage(userId, clientPhone, message, false);
        autoDetectUserClientInterest(userId, clientPhone, message);
        
        const userSession = getUserWhatsAppSession(userId);
        if (!userSession) {
            console.log(`❌ No WhatsApp session found for user ${userId}`);
            return;
        }
        
        if (userSession.isBotStopped) {
            console.log(`🤖 Bot is stopped for user ${userId} - no auto-reply`);
            return;
        }
        
        if (!shouldReplyToUserClient(userId, clientPhone)) {
            console.log(`⏸️ Client not in user ${userId}'s imported list - skipping auto-reply`);
            return;
        }
        
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
        
        await userSession.client.sendMessage(from, aiResponse);
        storeUserClientMessage(userId, clientPhone, aiResponse, true);
        updateUserReplyTimer(userId, clientPhone);
        
        if (currentSessions.has(userId)) {
            trackEmployeeActivity(userId, 'ai_reply', { clientPhone: clientPhone });
        }
        
        updateUserClientLastMessage(userId, clientPhone, aiResponse);
        
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

function getUserWhatsAppSession(userId) {
    return userWhatsAppSessions.get(userId);
}

function isUserWhatsAppConnected(userId) {
    const session = getUserWhatsAppSession(userId);
    return session && session.isConnected;
}

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
// AI RESPONSE FUNCTIONS
// =============================================

function shouldSendGreeting(phone) {
    try {
        // Simplified greeting logic
        return true;
    } catch (error) {
        console.error('Error checking greeting condition:', error);
        return true;
    }
}

async function callDeepSeekAI(userMessage, clientPhone) {
    if (!deepseekAvailable || !process.env.DEEPSEEK_API_KEY) {
        throw new Error('DeepSeek not available');
    }

    try {
        console.log('🚀 Calling DeepSeek API...');
        
        const shouldGreet = shouldSendGreeting(clientPhone);
        
        const messages = [
            {
                role: "system",
                content: AI_SYSTEM_PROMPT
            }
        ];

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

function generateEnhancedRagmcloudResponse(userMessage, clientPhone) {
    const msg = userMessage.toLowerCase().trim();
    const shouldGreet = shouldSendGreeting(clientPhone);
    
    console.log('🤖 Using enhanced Ragmcloud response for:', msg);
    
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
    
    if (msg.includes('نظام') || msg.includes('erp') || msg.includes('برنامج') || 
        msg.includes('سوفت وير') || msg.includes('system')) {
        
        return `🌟 **نظام رقم كلاود ERP السحابي**

هو حل متكامل لإدارة شركتك بشكل احترافي:

✅ **المميزات الأساسية:**
• محاسبة متكاملة مع الزكاة والضريبة
• إدارة مخزون ومستودعات ذكية
• نظام موارد بشرية ورواتب
• إدارة علاقات عملاء (CRM)
• تقارير وتحليلات فورية
• تكامل مع المنصات الحكومية

🚀 **فوائد للنظام:**
• توفير 50% من وقت المتابعة اليومية
• تقليل الأخطاء المحاسبية
• متابعة كل الفروع من مكان واحد
• تقارير فورية لاتخاذ القرارات

💼 **يناسب:**
• الشركات الصغيرة والمتوسطة
• المؤسسات التجارية والصناعية
• المستودعات ومراكز التوزيع
• شركات المقاولات والخدمات

📞 جرب النظام مجاناً: +966555111222`;
    }
    
    if (msg.includes('محاسبة') || msg.includes('محاسب') || msg.includes('حسابات') || 
        msg.includes('مالي') || msg.includes('accounting')) {
        
        return `🧮 **الحلول المحاسبية في رقم كلاود:**

📊 **النظام المحاسبي المتكامل:**
• الدفاتر المحاسبية المتكاملة
• تسجيل الفواتير والمصروفات
• الميزانيات والتقارير المالية
• التكامل مع الزكاة والضريبة
• كشوف الحسابات المصرفية

✅ **مميزات المحاسبة:**
• متوافق مع أنظمة الهيئة العامة للزكاة والضريبة
• تقارير مالية فورية وجاهزة
• نسخ احتياطي تلقائي للبيانات
• واجهة عربية سهلة الاستخدام

💡 **بتقدر تعمل:**
• متابعة حركة المبيعات والمشتريات
• تحليل التكاليف والأرباح
• إدارة التدفقات النقدية
• تقارير الأداء المالي

📞 استشارة محاسبية مجانية: +966555111222`;
    }
    
    if (msg.includes('مخزون') || msg.includes('مستودع') || msg.includes('بضاعة') || 
        msg.includes('inventory') || msg.includes('stock')) {
        
        return `📦 **نظام إدارة المخزون المتكامل:**

🔄 **إدارة المخزون الذكية:**
• تتبع البضاعة والمنتجات
• إدارة الفروع والمستودعات
• تنبيهات نقص المخزون الآلية
• تقارير حركة البضاعة
• جرد المخزون الآلي

🚀 **مميزات النظام:**
• تقارير ربحية المنتجات
• تحليل بطء وسرعة الحركة
• تكامل مع نظام المبيعات
• إدارة الموردين والمشتريات

💰 **وفّر على شركتك:**
• تقليل الهدر والفاقد
• تحسين التدفق النقدي
• زيادة كفاءة المستودعات

📞 للاستشارة: +966555111222`;
    }
    
    if (msg.includes('تجريب') || msg.includes('تجربة') || msg.includes('demo') || 
        msg.includes('جرب') || msg.includes('نسخة')) {
        
        return `🎯 **جرب نظام رقم كلاود مجاناً!**

نقدم لك نسخة تجريبية مجانية لمدة 7 أيام لتقييم النظام:

✅ **ما تحصل عليه في النسخة التجريبية:**
• الوصول الكامل لجميع الميزات
• دعم فني خلال فترة التجربة
• تدريب على استخدام النظام
• تقارير تجريبية لشركتك

📋 **لبدء التجربة:**
1. تواصل مع فريق المبيعات
2. حدد موعد للتدريب
3. ابدأ باستخدام النظام فوراً

📞 احجز نسختك التجريبية الآن: +966555111222
🌐 أو زور موقعنا: ragmcloud.sa

جرب وشوف الفرق في إدارة شركتك!`;
    }
    
    if (msg.includes('اتصل') || msg.includes('تواصل') || msg.includes('رقم') || 
        msg.includes('هاتف') || msg.includes('contact')) {
        
        return `📞 **تواصل مع فريق رقم كلاود:**

نحن هنا لمساعدتك في اختيار النظام المناسب:

**طرق التواصل:**
• الهاتف: +966555111222
• الواتساب: +966555111222  
• البريد: info@ragmcloud.sa
• الموقع: ragmcloud.sa

**أوقات العمل:**
من الأحد إلى الخميس
من 8 صباحاً إلى 6 مساءً

**مقرنا:**
الرياض - حي المغرزات - طريق الملك عبد الله

فريق المبيعات جاهز لاستقبال استفساراتك وتقديم الاستشارة المجانية!`;
    }
    
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

async function generateRagmcloudAIResponse(userMessage, clientPhone) {
    console.log('🔄 Processing message for Ragmcloud with memory:', userMessage);
    
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
    
    console.log('🤖 DeepSeek not available, using enhanced fallback');
    return generateEnhancedRagmcloudResponse(userMessage, clientPhone);
}

// =============================================
// UTILITY FUNCTIONS
// =============================================

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

function processExcelFile(filePath) {
    try {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const clients = jsonData.map((row, index) => {
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
            return client.phone && client.phone.length >= 10;
        });

        console.log('✅ Processed clients:', clients.length);
        
        return clients;
    } catch (error) {
        console.error('❌ Error processing Excel file:', error);
        throw error;
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
        
        const managerPhone = '966531304279@c.us';
        
        console.log('📤 Sending report to manager:', managerPhone);
        
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
        
        if (!fs.existsSync(path.join(__dirname, 'reports'))) {
            fs.mkdirSync(path.join(__dirname, 'reports'), { recursive: true });
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

app.get('/user-management', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'user-management.html'));
});

app.get('/user-dashboard/:userId', authenticateUser, authorizeAdmin, (req, res) => {
    const targetUserId = parseInt(req.params.userId);
    const targetUser = users.find(u => u.id === targetUserId);
    
    if (!targetUser) {
        return res.status(404).json({ error: 'المستخدم غير موجود' });
    }
    
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

app.post('/api/logout', authenticateUser, (req, res) => {
    try {
        const userId = req.user.id;
        
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

// User WhatsApp Status Route
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

// User WhatsApp QR Code Route
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

// User-specific Bot Control Route
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

// User-specific WhatsApp Reconnection
app.post('/api/user-reconnect-whatsapp', authenticateUser, (req, res) => {
    try {
        const userId = req.user.id;
        manualReconnectUserWhatsApp(userId);
        res.json({ success: true, message: 'جارٍ إعادة الاتصال...' });
    } catch (error) {
        res.status(500).json({ error: 'فشل إعادة الاتصال' });
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

// User-specific Clients Route
app.get('/api/user-clients', authenticateUser, (req, res) => {
    try {
        const userId = req.user.id;
        const clients = getUserClients(userId);
        res.json({ success: true, clients: clients });
    } catch (error) {
        res.json({ success: true, clients: [] });
    }
});

// User-specific Client Messages Route
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

// User-specific Upload Excel
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

        const userId = req.user.id;
        const userSession = getUserWhatsAppSession(userId);
        if (userSession) {
            clients.forEach(client => {
                userSession.importedClients.add(client.phone);
            });
        }

        storeUserClients(userId, clients);
        fs.unlinkSync(req.file.path);

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
        const { message, delay = 3, clients } = req.body;
        
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
                if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, delay * 1000));
                }
                
                await userSession.client.sendMessage(phoneNumber, message);
                
                successCount++;
                
                client.lastMessage = message.substring(0, 50) + (message.length > 50 ? '...' : '');
                client.lastSent = new Date().toISOString();
                
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

                storeUserClientMessage(userId, client.phone, message, true);
                
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
        
        trackEmployeeActivity(userId, 'message_sent', { 
            clientPhone: formattedPhone,
            message: message.substring(0, 30) 
        });
        
        storeUserClientMessage(userId, phone, message, true);
        updateUserClientLastMessage(userId, phone, message);
        
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
            
            const userClients = getUserClients(user.id);
            socket.emit(`user_clients_updated_${user.id}`, userClients);
            
        } catch (error) {
            socket.emit('auth_error', { error: 'خطأ في المصادقة' });
        }
    });

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

    socket.on('update_client_status', (data) => {
        if (!socket.userId) return;
        updateUserClientStatus(socket.userId, data.phone, data.status);
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
            
            trackEmployeeActivity(socket.userId, 'message_sent', { 
                clientPhone: formattedPhone,
                message: message.substring(0, 30) 
            });
            
            storeUserClientMessage(socket.userId, to, message, true);
            updateUserClientLastMessage(socket.userId, to, message);
            
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
    console.log('📁 USER-SPECIFIC DATA: ENABLED');
    console.log('🎯 SESSION ISOLATION: COMPLETED');
    console.log('👑 ADMIN NAVIGATION: ENABLED');
    console.log('📊 SEPARATE USER MANAGEMENT: READY');
});
