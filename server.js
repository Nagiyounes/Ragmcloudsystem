const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const mysql = require('mysql2/promise');
const multer = require('multer');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const xlsx = require('xlsx');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Database configuration
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'ragmcloud_erp'
};

// JWT Secret
const JWT_SECRET = 'your-secret-key-here';

// Store user sessions and WhatsApp clients
const userSessions = new Map();

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Database connection pool
const createPool = () => {
  return mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
};

let pool;

// Initialize database connection
async function initializeDatabase() {
  try {
    pool = createPool();
    
    // Create tables if they don't exist
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role ENUM('admin', 'standard') DEFAULT 'standard',
        isActive BOOLEAN DEFAULT true,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS clients (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        status ENUM('interested', 'busy', 'not-interested', 'no-reply') DEFAULT 'no-reply',
        lastMessage TEXT,
        lastActivity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        unread INT DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        client_phone VARCHAR(20) NOT NULL,
        message TEXT NOT NULL,
        fromMe BOOLEAN DEFAULT false,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS performance_stats (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        date DATE NOT NULL,
        messagesSent INT DEFAULT 0,
        aiRepliesSent INT DEFAULT 0,
        clientsContacted INT DEFAULT 0,
        interestedClients INT DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_date (user_id, date)
      )
    `);

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
  }
}

// Initialize WhatsApp client for a user
async function initializeWhatsAppClient(userId) {
  try {
    console.log(`🔄 Initializing WhatsApp client for user ${userId}`);
    
    const client = new Client({
      authStrategy: new LocalAuth({ 
        clientId: `user-${userId}`,
        dataPath: './whatsapp-auth'
      }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    });

    let qrCodeSent = false;

    client.on('qr', async (qr) => {
      console.log(`📱 QR Code generated for user ${userId}`);
      
      try {
        const qrCodeUrl = await qrcode.toDataURL(qr);
        
        // Store QR code in session
        if (userSessions.has(userId)) {
          userSessions.get(userId).qrCode = qrCodeUrl;
        }
        
        // Emit QR code to specific user
        io.to(`user_${userId}`).emit(`user_qr_${userId}`, {
          qrCode: qrCodeUrl,
          message: 'QR Code ready for scanning'
        });
        
        qrCodeSent = true;
        console.log(`✅ QR Code sent to user ${userId}`);
      } catch (error) {
        console.error(`❌ Error generating QR code for user ${userId}:`, error);
      }
    });

    client.on('ready', () => {
      console.log(`✅ WhatsApp client ready for user ${userId}`);
      
      // Update user session
      if (userSessions.has(userId)) {
        userSessions.get(userId).whatsappReady = true;
        userSessions.get(userId).qrCode = null;
      }
      
      // Emit ready status to specific user
      io.to(`user_${userId}`).emit(`user_status_${userId}`, {
        connected: true,
        message: 'WhatsApp Connected',
        status: 'connected'
      });
    });

    client.on('authenticated', () => {
      console.log(`🔐 WhatsApp authenticated for user ${userId}`);
    });

    client.on('auth_failure', (error) => {
      console.error(`❌ WhatsApp auth failure for user ${userId}:`, error);
      
      io.to(`user_${userId}`).emit(`user_status_${userId}`, {
        connected: false,
        message: 'Authentication Failed',
        status: 'auth_failed'
      });
    });

    client.on('disconnected', (reason) => {
      console.log(`❌ WhatsApp disconnected for user ${userId}:`, reason);
      
      // Update user session
      if (userSessions.has(userId)) {
        userSessions.get(userId).whatsappReady = false;
      }
      
      io.to(`user_${userId}`).emit(`user_status_${userId}`, {
        connected: false,
        message: 'WhatsApp Disconnected',
        status: 'disconnected'
      });
      
      // Reinitialize after disconnect
      setTimeout(() => {
        if (userSessions.has(userId) && !userSessions.get(userId).whatsappReady) {
          console.log(`🔄 Reinitializing WhatsApp for user ${userId} after disconnect`);
          initializeWhatsAppClient(userId);
        }
      }, 5000);
    });

    client.on('message', async (message) => {
      try {
        console.log(`📨 Message received for user ${userId}:`, message.body);
        
        // Save received message to database
        const [result] = await pool.execute(
          'INSERT INTO messages (user_id, client_phone, message, fromMe) VALUES (?, ?, ?, ?)',
          [userId, message.from, message.body, false]
        );

        // Update client last message and activity
        await updateClientLastMessage(userId, message.from, message.body);

        // Emit message to specific user
        io.to(`user_${userId}`).emit(`user_message_${userId}`, {
          clientPhone: message.from,
          message: message.body,
          fromMe: false,
          timestamp: new Date()
        });

        // Handle AI replies if enabled
        const userSession = userSessions.get(userId);
        if (userSession && userSession.isAIMode) {
          await handleAIResponse(userId, message);
        }

      } catch (error) {
        console.error(`❌ Error handling message for user ${userId}:`, error);
      }
    });

    // Store client in user session
    if (!userSessions.has(userId)) {
      userSessions.set(userId, {
        whatsappClient: client,
        whatsappReady: false,
        qrCode: null,
        isAIMode: true,
        isBotStopped: false
      });
    } else {
      userSessions.get(userId).whatsappClient = client;
    }

    // Initialize client
    await client.initialize();

  } catch (error) {
    console.error(`❌ Failed to initialize WhatsApp client for user ${userId}:`, error);
  }
}

// Update client last message
async function updateClientLastMessage(userId, phone, message) {
  try {
    // Find or create client
    const [clientRows] = await pool.execute(
      'SELECT id FROM clients WHERE user_id = ? AND phone = ?',
      [userId, phone]
    );

    if (clientRows.length === 0) {
      // Create new client
      await pool.execute(
        'INSERT INTO clients (user_id, name, phone, lastMessage) VALUES (?, ?, ?, ?)',
        [userId, phone, phone, message]
      );
    } else {
      // Update existing client
      await pool.execute(
        'UPDATE clients SET lastMessage = ?, lastActivity = CURRENT_TIMESTAMP, unread = unread + 1 WHERE user_id = ? AND phone = ?',
        [message, userId, phone]
      );
    }
  } catch (error) {
    console.error('Error updating client last message:', error);
  }
}

// Handle AI responses
async function handleAIResponse(userId, message) {
  try {
    const userSession = userSessions.get(userId);
    if (!userSession || userSession.isBotStopped) return;

    // Simple AI response logic (replace with your actual AI service)
    let response = '';
    const messageText = message.body.toLowerCase();

    if (messageText.includes('سعر') || messageText.includes('تكلفة') || messageText.includes('ثمن')) {
      response = '🚀 نظام رقم كلاود ERP يبدأ من 199 ريال شهرياً! جلسة استشارية مجانية لمعرفة احتياجاتك بالضبط. 📞 +966555111222';
    } else if (messageText.includes('مميزات') || messageText.includes('ميزات') || messageText.includes('features')) {
      response = '🌟 مميزات نظام رقم كلاود ERP:\n• محاسبة متكاملة\n• إدارة المخزون\n• الموارد البشرية\n• التقارير الذكية\n• دعم فني 24/7\n• نسخة تجريبية مجانية!';
    } else if (messageText.includes('شكر') || messageText.includes('thanks') || messageText.includes('thank')) {
      response = '🤝 العفو! نحن هنا لخدمتك. هل تريد معرفة المزيد عن نظام رقم كلاود ERP؟';
    } else if (messageText.includes('مرحبا') || messageText.includes('اهلا') || messageText.includes('hello')) {
      response = '👋 أهلاً وسهلاً! 🌟 نظام رقم كلاود ERP السحابي يحول عملك لنسخة أكثر ذكاءً وكفاءة. هل تريد جلسة استشارية مجانية؟';
    } else {
      // Default promotional response
      response = '🚀 نظام رقم كلاود ERP السحابي! حلول متكاملة للمحاسبة، المخزون، الموارد البشرية، والمزيد. جلسة استشارية مجانية! 📞 +966555111222 🌐 ragmcloud.sa';
    }

    // Send AI response
    const client = userSession.whatsappClient;
    if (client && userSession.whatsappReady) {
      await client.sendMessage(message.from, response);
      
      // Save AI response to database
      await pool.execute(
        'INSERT INTO messages (user_id, client_phone, message, fromMe) VALUES (?, ?, ?, ?)',
        [userId, message.from, response, true]
      );

      // Update performance stats
      await updatePerformanceStats(userId, 'aiRepliesSent');

      // Emit AI response to user
      io.to(`user_${userId}`).emit(`user_message_${userId}`, {
        clientPhone: message.from,
        message: response,
        fromMe: true,
        timestamp: new Date(),
        isAI: true
      });
    }
  } catch (error) {
    console.error(`❌ Error in AI response for user ${userId}:`, error);
  }
}

// Update performance stats
async function updatePerformanceStats(userId, field) {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    await pool.execute(
      `INSERT INTO performance_stats (user_id, date, ${field}) 
       VALUES (?, ?, 1) 
       ON DUPLICATE KEY UPDATE ${field} = ${field} + 1`,
      [userId, today]
    );
  } catch (error) {
    console.error('Error updating performance stats:', error);
  }
}

// API Routes

// User Authentication
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const [users] = await pool.execute(
      'SELECT * FROM users WHERE username = ? AND isActive = true',
      [username]
    );

    if (users.length === 0) {
      return res.status(401).json({ success: false, error: 'المستخدم غير موجود' });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ success: false, error: 'كلمة المرور غير صحيحة' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'خطأ في الخادم' });
  }
});

// Get current user
app.get('/api/me', authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.execute(
      'SELECT id, name, username, role FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
    }

    res.json({
      success: true,
      user: users[0]
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, error: 'خطأ في الخادم' });
  }
});

// Get users (admin only)
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'غير مسموح' });
    }

    const [users] = await pool.execute(
      'SELECT id, name, username, role, isActive FROM users'
    );

    res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, error: 'خطأ في الخادم' });
  }
});

// Create user (admin only)
app.post('/api/users', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'غير مسموح' });
    }

    const { name, username, password, role } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.execute(
      'INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)',
      [name, username, hashedPassword, role]
    );

    res.json({
      success: true,
      message: 'تم إضافة المستخدم بنجاح'
    });
  } catch (error) {
    console.error('Create user error:', error);
    
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, error: 'اسم المستخدم موجود مسبقاً' });
    }
    
    res.status(500).json({ success: false, error: 'خطأ في الخادم' });
  }
});

// Get user WhatsApp status
app.get('/api/user-whatsapp-status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userSession = userSessions.get(userId);

    if (!userSession) {
      return res.json({
        connected: false,
        message: 'غير متصل',
        status: 'disconnected',
        hasQr: false
      });
    }

    if (userSession.whatsappReady) {
      return res.json({
        connected: true,
        message: 'متصل بالواتساب',
        status: 'connected',
        hasQr: false
      });
    } else if (userSession.qrCode) {
      return res.json({
        connected: false,
        message: 'جاهز للمسح',
        status: 'qr-ready',
        hasQr: true,
        qrCode: userSession.qrCode
      });
    } else {
      return res.json({
        connected: false,
        message: 'جاري التهيئة...',
        status: 'initializing',
        hasQr: false
      });
    }
  } catch (error) {
    console.error('Get WhatsApp status error:', error);
    res.status(500).json({ success: false, error: 'خطأ في الخادم' });
  }
});

// Get user QR code
app.get('/api/user-whatsapp-qr', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userSession = userSessions.get(userId);

    if (!userSession || !userSession.qrCode) {
      return res.status(404).json({ success: false, error: 'QR Code غير متوفر' });
    }

    res.json({
      success: true,
      qrCode: userSession.qrCode
    });
  } catch (error) {
    console.error('Get QR code error:', error);
    res.status(500).json({ success: false, error: 'خطأ في الخادم' });
  }
});

// Upload Excel file
const upload = multer({ dest: 'uploads/' });
app.post('/api/upload-excel', authenticateToken, upload.single('excelFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'لم يتم اختيار ملف' });
    }

    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const clients = [];
    
    for (const row of data) {
      const name = row['Name'] || row['name'] || row['الاسم'] || 'عميل';
      const phone = row['Phone'] || row['phone'] || row['الهاتف'] || row['رقم الهاتف'];
      
      if (phone) {
        // Format phone number (ensure it's in international format)
        let formattedPhone = phone.toString().replace(/\D/g, '');
        if (!formattedPhone.startsWith('+')) {
          if (formattedPhone.startsWith('0')) {
            formattedPhone = '966' + formattedPhone.substring(1);
          }
          formattedPhone = formattedPhone + '@c.us';
        }

        clients.push({
          name,
          phone: formattedPhone,
          status: 'no-reply',
          lastMessage: '',
          unread: 0
        });

        // Insert or update client in database
        await pool.execute(
          `INSERT INTO clients (user_id, name, phone, status, lastMessage, unread) 
           VALUES (?, ?, ?, ?, ?, ?) 
           ON DUPLICATE KEY UPDATE name = VALUES(name)`,
          [req.user.id, name, formattedPhone, 'no-reply', '', 0]
        );
      }
    }

    res.json({
      success: true,
      message: `تم رفع ${clients.length} عميل بنجاح`,
      count: clients.length,
      clients
    });
  } catch (error) {
    console.error('Upload Excel error:', error);
    res.status(500).json({ success: false, error: 'خطأ في رفع الملف' });
  }
});

// Get clients
app.get('/api/clients', authenticateToken, async (req, res) => {
  try {
    const [clients] = await pool.execute(
      'SELECT * FROM clients WHERE user_id = ? ORDER BY lastActivity DESC',
      [req.user.id]
    );

    res.json({
      success: true,
      clients
    });
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({ success: false, error: 'خطأ في جلب العملاء' });
  }
});

// Get client messages
app.get('/api/client-messages/:clientId', authenticateToken, async (req, res) => {
  try {
    const clientId = req.params.clientId;

    // Get client phone first
    const [clients] = await pool.execute(
      'SELECT phone FROM clients WHERE id = ? AND user_id = ?',
      [clientId, req.user.id]
    );

    if (clients.length === 0) {
      return res.status(404).json({ success: false, error: 'العميل غير موجود' });
    }

    const clientPhone = clients[0].phone;

    // Get messages
    const [messages] = await pool.execute(
      'SELECT * FROM messages WHERE user_id = ? AND client_phone = ? ORDER BY timestamp ASC',
      [req.user.id, clientPhone]
    );

    // Reset unread count
    await pool.execute(
      'UPDATE clients SET unread = 0 WHERE id = ? AND user_id = ?',
      [clientId, req.user.id]
    );

    res.json({
      success: true,
      messages
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ success: false, error: 'خطأ في جلب الرسائل' });
  }
});

// Send bulk messages
app.post('/api/send-bulk', authenticateToken, async (req, res) => {
  try {
    const { message, delay, clients } = req.body;
    const userId = req.user.id;
    const userSession = userSessions.get(userId);

    if (!userSession || !userSession.whatsappReady) {
      return res.status(400).json({ success: false, error: 'الواتساب غير متصل' });
    }

    if (userSession.isBotStopped) {
      return res.status(400).json({ success: false, error: 'البوت متوقف' });
    }

    res.json({
      success: true,
      message: 'بدأ الإرسال الجماعي'
    });

    // Start bulk sending in background
    startBulkSending(userId, clients, message, delay);

  } catch (error) {
    console.error('Send bulk error:', error);
    res.status(500).json({ success: false, error: 'خطأ في الإرسال الجماعي' });
  }
});

// Start bulk sending
async function startBulkSending(userId, clients, message, delay) {
  try {
    const userSession = userSessions.get(userId);
    if (!userSession || !userSession.whatsappReady) return;

    const client = userSession.whatsappClient;

    for (let i = 0; i < clients.length; i++) {
      if (userSession.isBotStopped) break;

      const clientData = clients[i];
      
      try {
        await client.sendMessage(clientData.phone, message);
        
        // Save sent message to database
        await pool.execute(
          'INSERT INTO messages (user_id, client_phone, message, fromMe) VALUES (?, ?, ?, ?)',
          [userId, clientData.phone, message, true]
        );

        // Update client last message
        await pool.execute(
          'UPDATE clients SET lastMessage = ?, lastActivity = CURRENT_TIMESTAMP WHERE user_id = ? AND phone = ?',
          [message, userId, clientData.phone]
        );

        // Update performance stats
        await updatePerformanceStats(userId, 'messagesSent');

        // Emit progress
        io.to(`user_${userId}`).emit('bulk_progress', {
          type: 'success',
          client: clientData.name,
          clientPhone: clientData.phone,
          success: true
        });

      } catch (error) {
        console.error(`Failed to send to ${clientData.phone}:`, error);
        
        io.to(`user_${userId}`).emit('bulk_progress', {
          type: 'error',
          client: clientData.name,
          clientPhone: clientData.phone,
          success: false,
          error: error.message
        });
      }

      // Delay between messages
      if (i < clients.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
      }
    }

    io.to(`user_${userId}`).emit('bulk_progress', {
      type: 'complete',
      message: 'تم الانتهاء من الإرسال الجماعي'
    });

  } catch (error) {
    console.error('Bulk sending error:', error);
  }
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('🔌 New client connected:', socket.id);

  socket.on('authenticate', async (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const userId = decoded.id;

      // Join user-specific room
      socket.join(`user_${userId}`);
      
      console.log(`✅ User ${userId} authenticated on socket ${socket.id}`);

      // Initialize WhatsApp client if not already initialized
      if (!userSessions.has(userId)) {
        await initializeWhatsAppClient(userId);
      }

      // Send current status
      const userSession = userSessions.get(userId);
      if (userSession) {
        if (userSession.whatsappReady) {
          socket.emit(`user_status_${userId}`, {
            connected: true,
            message: 'WhatsApp Connected',
            status: 'connected'
          });
        } else if (userSession.qrCode) {
          socket.emit(`user_qr_${userId}`, {
            qrCode: userSession.qrCode,
            message: 'QR Code ready for scanning'
          });
        }

        // Send bot status
        socket.emit(`user_bot_status_${userId}`, {
          stopped: userSession.isBotStopped
        });
      }

      socket.userId = userId;

    } catch (error) {
      console.error('Authentication error:', error);
      socket.emit('auth_error', 'Authentication failed');
    }
  });

  // Send message
  socket.on('send_message', async (data) => {
    try {
      const userId = socket.userId;
      if (!userId) return;

      const userSession = userSessions.get(userId);
      if (!userSession || !userSession.whatsappReady) {
        socket.emit('error', { message: 'WhatsApp is not connected' });
        return;
      }

      const { to, message } = data;
      const client = userSession.whatsappClient;

      await client.sendMessage(to, message);

      // Save message to database
      await pool.execute(
        'INSERT INTO messages (user_id, client_phone, message, fromMe) VALUES (?, ?, ?, ?)',
        [userId, to, message, true]
      );

      // Update performance stats
      await updatePerformanceStats(userId, 'messagesSent');

      // Emit sent message
      socket.emit(`user_message_${userId}`, {
        clientPhone: to,
        message: message,
        fromMe: true,
        timestamp: new Date()
      });

    } catch (error) {
      console.error('Send message error:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Update client status
  socket.on('update_client_status', async (data) => {
    try {
      const userId = socket.userId;
      if (!userId) return;

      const { phone, status } = data;

      await pool.execute(
        'UPDATE clients SET status = ? WHERE user_id = ? AND phone = ?',
        [status, userId, phone]
      );

      // Emit status update to all users in room
      io.to(`user_${userId}`).emit('client_status_updated', {
        clientPhone: phone,
        status: status
      });

      if (status === 'interested') {
        await updatePerformanceStats(userId, 'interestedClients');
      }

    } catch (error) {
      console.error('Update client status error:', error);
    }
  });

  // Toggle bot
  socket.on('user_toggle_bot', (data) => {
    const userId = socket.userId;
    if (!userId) return;

    const userSession = userSessions.get(userId);
    if (userSession) {
      userSession.isBotStopped = data.stop;
      
      io.to(`user_${userId}`).emit(`user_bot_status_${userId}`, {
        stopped: data.stop
      });
    }
  });

  // Reconnect WhatsApp
  socket.on('user_reconnect_whatsapp', async () => {
    const userId = socket.userId;
    if (!userId) return;

    console.log(`🔄 Reconnecting WhatsApp for user ${userId}`);
    
    const userSession = userSessions.get(userId);
    if (userSession && userSession.whatsappClient) {
      await userSession.whatsappClient.destroy();
    }

    await initializeWhatsAppClient(userId);
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

// Initialize server
async function startServer() {
  await initializeDatabase();
  
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 WhatsApp ERP Dashboard: http://localhost:${PORT}`);
  });
}

// Create default admin user on startup
async function createDefaultAdmin() {
  try {
    const [users] = await pool.execute('SELECT id FROM users WHERE role = "admin"');
    
    if (users.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      
      await pool.execute(
        'INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)',
        ['مدير النظام', 'admin', hashedPassword, 'admin']
      );
      
      console.log('✅ Default admin user created: admin / admin123');
    }
  } catch (error) {
    console.error('Error creating default admin:', error);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down server...');
  
  // Destroy all WhatsApp clients
  for (const [userId, session] of userSessions.entries()) {
    if (session.whatsappClient) {
      await session.whatsappClient.destroy();
    }
  }
  
  if (pool) {
    await pool.end();
  }
  
  process.exit(0);
});

// Start the server
startServer().then(() => {
  setTimeout(createDefaultAdmin, 2000);
});
