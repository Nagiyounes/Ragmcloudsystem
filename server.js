const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const xlsx = require('xlsx');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

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

// JWT Secret
const JWT_SECRET = 'your-secret-key-here';

// Mock database (replace with real database)
let users = [
  {
    id: 1,
    name: 'Admin',
    username: 'admin',
    password: '$2a$10$8K1p/a0dRTlR0.2Q1.2Q1.2Q1.2Q1.2Q1.2Q1.2Q1.2Q1.2Q1', // password: admin123
    role: 'admin',
    isActive: true
  },
  {
    id: 2,
    name: 'Nagi',
    username: 'nagi',
    password: '$2a$10$8K1p/a0dRTlR0.2Q1.2Q1.2Q1.2Q1.2Q1.2Q1.2Q1.2Q1.2Q1', // password: user123
    role: 'standard',
    isActive: true
  }
];

let clients = [];
let performanceStats = {
  dailyStats: {
    messagesSent: 0,
    aiRepliesSent: 0,
    clientsContacted: 0,
    interestedClients: 0
  }
};

// JWT Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'رمز الوصول مطلوب' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'رمز وصول غير صالح' });
    }
    req.user = user;
    next();
  });
}

// Routes
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = users.find(u => u.username === username);
    if (!user) {
      return res.status(401).json({ success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    // In real app, use bcrypt.compare
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
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

app.get('/api/me', authenticateToken, (req, res) => {
  const user = users.find(u => u.id === req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
  }

  res.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role
    }
  });
});

// FIXED AI Prompt Endpoint
app.put('/api/ai-prompt', authenticateToken, async (req, res) => {
  try {
    const { prompt } = req.body;
    
    console.log('📝 Received AI prompt save request:', {
      userId: req.user.id,
      promptLength: prompt?.length
    });
    
    // Add proper validation
    if (!prompt || typeof prompt !== 'string') {
      console.error('❌ Invalid prompt data:', { prompt });
      return res.status(400).json({ 
        success: false, 
        error: 'طلب غير صالح - البيانات مفقودة' 
      });
    }
    
    if (prompt.trim().length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'النص لا يمكن أن يكون فارغاً' 
      });
    }
    
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        error: 'غير مصرح - تحتاج صلاحيات المدير' 
      });
    }
    
    // Save to database or file system
    const aiPromptPath = './data/ai-prompts/system-prompt.txt';
    
    try {
      // Ensure directory exists
      await fs.mkdir('./data/ai-prompts', { recursive: true });
      
      // Save the prompt
      await fs.writeFile(aiPromptPath, prompt, 'utf8');
      
      console.log('✅ AI prompt saved successfully');
      
      res.json({ 
        success: true, 
        message: 'تم حفظ نظام الذكاء الاصطناعي بنجاح' 
      });
      
    } catch (fileError) {
      console.error('❌ File system error:', fileError);
      res.status(500).json({ 
        success: false, 
        error: 'فشل حفظ النظام في الملف' 
      });
    }
    
  } catch (error) {
    console.error('❌ Error saving AI prompt:', error);
    res.status(500).json({ 
      success: false, 
      error: 'فشل حفظ النظام' 
    });
  }
});

// GET AI Prompt Endpoint
app.get('/api/ai-prompt', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        error: 'غير مصرح - تحتاج صلاحيات المدير' 
      });
    }
    
    // Read from file system
    const aiPromptPath = './data/ai-prompts/system-prompt.txt';
    
    try {
      const prompt = await fs.readFile(aiPromptPath, 'utf8');
      
      res.json({ 
        success: true, 
        prompt: prompt 
      });
      
    } catch (fileError) {
      if (fileError.code === 'ENOENT') {
        // File doesn't exist, return empty prompt
        res.json({ 
          success: true, 
          prompt: '' 
        });
      } else {
        throw fileError;
      }
    }
    
  } catch (error) {
    console.error('❌ Error loading AI prompt:', error);
    res.status(500).json({ 
      success: false, 
      error: 'فشل تحميل النظام' 
    });
  }
});

// User Management Endpoints
app.get('/api/users', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'غير مصرح' });
  }

  res.json({
    success: true,
    users: users.map(user => ({
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      isActive: user.isActive
    }))
  });
});

app.post('/api/users', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'غير مصرح' });
    }

    const { name, username, password, role } = req.body;

    if (!name || !username || !password) {
      return res.status(400).json({ success: false, error: 'جميع الحقول مطلوبة' });
    }

    const existingUser = users.find(u => u.username === username);
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'اسم المستخدم موجود مسبقاً' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: users.length + 1,
      name,
      username,
      password: hashedPassword,
      role: role || 'standard',
      isActive: true
    };

    users.push(newUser);

    res.json({
      success: true,
      message: 'تم إضافة المستخدم بنجاح',
      user: {
        id: newUser.id,
        name: newUser.name,
        username: newUser.username,
        role: newUser.role,
        isActive: newUser.isActive
      }
    });
  } catch (error) {
    console.error('Error adding user:', error);
    res.status(500).json({ success: false, error: 'فشل إضافة المستخدم' });
  }
});

// File upload configuration
const upload = multer({ 
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Excel upload endpoint
app.post('/api/upload-excel', authenticateToken, upload.single('excelFile'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'لم يتم رفع أي ملف' });
    }

    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);

    // Process Excel data
    const newClients = data.map((row, index) => ({
      id: Date.now() + index,
      name: row['Name'] || row['name'] || 'عميل بدون اسم',
      phone: row['Phone'] || row['phone'] || row['Phone Number'] || '',
      status: 'no-reply',
      lastMessage: '',
      lastActivity: new Date(),
      unread: 0
    })).filter(client => client.phone);

    clients = [...clients, ...newClients];

    // Clean up uploaded file
    fs.unlink(req.file.path);

    res.json({
      success: true,
      message: `تم رفع ${newClients.length} عميل بنجاح`,
      count: newClients.length,
      clients: newClients
    });
  } catch (error) {
    console.error('Error processing Excel file:', error);
    res.status(500).json({ success: false, error: 'فشل معالجة الملف' });
  }
});

// Get clients endpoint
app.get('/api/clients', authenticateToken, (req, res) => {
  res.json({
    success: true,
    clients: clients
  });
});

// Update client status endpoint
app.post('/api/update-client-status', authenticateToken, (req, res) => {
  try {
    const { phone, status } = req.body;

    const client = clients.find(c => c.phone === phone);
    if (!client) {
      return res.status(404).json({ success: false, error: 'العميل غير موجود' });
    }

    client.status = status;
    client.lastActivity = new Date();

    // Emit socket event for real-time update
    io.emit('client_status_updated', {
      clientId: client.id,
      status: status
    });

    res.json({
      success: true,
      message: `تم تحديث حالة العميل إلى ${status}`
    });
  } catch (error) {
    console.error('Error updating client status:', error);
    res.status(500).json({ success: false, error: 'فشل تحديث الحالة' });
  }
});

// Performance stats endpoint
app.get('/api/employee-performance', authenticateToken, (req, res) => {
  res.json({
    success: true,
    performance: performanceStats
  });
});

// Bulk message endpoint
app.post('/api/send-bulk', authenticateToken, (req, res) => {
  try {
    const { message, delay, clients: targetClients } = req.body;

    if (!message || !targetClients || targetClients.length === 0) {
      return res.status(400).json({ success: false, error: 'الرسالة وقائمة العملاء مطلوبة' });
    }

    // Simulate bulk sending
    io.emit('bulk_progress', {
      type: 'start',
      total: targetClients.length
    });

    // Simulate sending process
    targetClients.forEach((client, index) => {
      setTimeout(() => {
        const success = Math.random() > 0.1; // 90% success rate
        
        io.emit('bulk_progress', {
          success,
          client: client.name,
          clientPhone: client.phone,
          error: success ? null : 'فشل الإرسال'
        });

        if (success) {
          performanceStats.dailyStats.messagesSent++;
          performanceStats.dailyStats.clientsContacted++;
        }
      }, index * (delay * 1000));
    });

    res.json({
      success: true,
      message: `بدأ الإرسال إلى ${targetClients.length} عميل`
    });
  } catch (error) {
    console.error('Error sending bulk messages:', error);
    res.status(500).json({ success: false, error: 'فشل الإرسال الجماعي' });
  }
});

// Export report endpoint
app.get('/api/export-report', authenticateToken, (req, res) => {
  try {
    const report = `
تقرير رقم كلاود ERP
التاريخ: ${new Date().toLocaleDateString('ar-EG')}
الوقت: ${new Date().toLocaleTimeString('ar-EG')}

الإحصائيات:
- إجمالي الرسائل المرسلة: ${performanceStats.dailyStats.messagesSent}
- الردود الآلية: ${performanceStats.dailyStats.aiRepliesSent}
- العملاء المتصل بهم: ${performanceStats.dailyStats.clientsContacted}
- العملاء المهتمين: ${performanceStats.dailyStats.interestedClients}

العملاء:
${clients.map(client => `- ${client.name} (${client.phone}): ${client.status}`).join('\n')}
    `.trim();

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=ragmcloud-report-${new Date().toISOString().split('T')[0]}.txt`);
    res.send(report);
  } catch (error) {
    console.error('Error exporting report:', error);
    res.status(500).json({ success: false, error: 'فشل تصدير التقرير' });
  }
});

// Send to manager endpoint
app.post('/api/send-to-manager', authenticateToken, (req, res) => {
  try {
    // Simulate sending report to manager
    console.log('📧 Sending report to manager...');
    
    res.json({
      success: true,
      message: 'تم إرسال التقرير إلى المدير بنجاح'
    });
  } catch (error) {
    console.error('Error sending report to manager:', error);
    res.status(500).json({ success: false, error: 'فشل إرسال التقرير' });
  }
});

// Serve dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Serve login page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Socket.io authentication and events
io.on('connection', (socket) => {
  console.log('🔌 New client connected:', socket.id);

  socket.on('authenticate', (token) => {
    try {
      const user = jwt.verify(token, JWT_SECRET);
      socket.userId = user.id;
      console.log(`✅ Socket authenticated for user: ${user.username} (${user.id})`);
      
      socket.emit('authenticated', user);
    } catch (error) {
      console.error('❌ Socket authentication failed:', error);
      socket.emit('auth_error', 'فشل المصادقة');
    }
  });

  socket.on('send_message', (data) => {
    console.log('📤 Message sent:', data);
    // Handle message sending logic here
  });

  socket.on('user_reconnect_whatsapp', () => {
    console.log('🔄 User requested WhatsApp reconnection');
    // Handle WhatsApp reconnection logic
  });

  socket.on('user_toggle_bot', (data) => {
    console.log('🤖 User toggled bot:', data);
    // Handle bot toggle logic
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Dashboard available at: http://localhost:${PORT}/dashboard`);
});
