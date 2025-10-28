# Ragmcloud WhatsApp CRM - Production Ready Version

A comprehensive multi-user WhatsApp automation platform with AI integration, employee performance tracking, and enterprise-grade security.

## ✨ Key Improvements in This Version

### 🔒 Security Enhancements
- **JWT Authentication** with strong secret requirement
- **Rate limiting** to prevent abuse (100 requests/15min general, 10 requests/15min for login)
- **Input validation** using express-validator
- **Helmet.js** for security headers
- **CORS protection** with configurable origins
- **SQL injection protection** through parameterized queries
- **XSS protection** through input sanitization

### 🚀 Performance & Reliability
- **Message queue** support with Bull/Redis for reliable message delivery
- **Automatic session cleanup** to prevent memory leaks
- **Exponential backoff** for reconnection attempts
- **Connection pooling** for better resource management
- **Graceful shutdown** handling
- **Health check endpoints** for monitoring

### 📊 Monitoring & Logging
- **Winston logger** with rotating log files
- **Structured logging** with different log levels
- **Error tracking** and reporting
- **Performance metrics** collection
- **Automatic log cleanup** (7-day retention)

### 🔧 Code Quality
- **Proper error handling** throughout
- **Async/await** patterns for better flow control
- **Memory leak prevention** with session cleanup
- **Environment variable validation** on startup
- **TypeScript-ready** structure

## 📋 Prerequisites

- Node.js >= 14.0.0
- npm >= 6.0.0
- Redis (optional, for message queue)
- MongoDB (optional, for future database integration)
- Chrome/Chromium browser

## 🚀 Quick Start

### 1. Clone and Install

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
```

### 2. Configure Environment Variables

Edit `.env` file with your values:

```env
# Required
JWT_SECRET=your-very-strong-random-secret-minimum-32-chars
DEEPSEEK_API_KEY=your-deepseek-api-key

# Optional but recommended
REDIS_URL=redis://localhost:6379
MONGODB_URI=mongodb://localhost:27017/ragmcloud
```

### 3. Run the Application

```bash
# Production mode
npm start

# Development mode with auto-reload
npm run dev
```

## 🔧 Configuration Guide

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `JWT_SECRET` | Secret key for JWT tokens (min 32 chars) | `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0` |
| `DEEPSEEK_API_KEY` | API key for DeepSeek AI | `sk-xxxxxxxxxxxxxxxx` |

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `10000` |
| `NODE_ENV` | Environment mode | `production` |
| `MANAGER_PHONE` | Manager WhatsApp number | `966531304279` |
| `REDIS_URL` | Redis connection URL | - |
| `MONGODB_URI` | MongoDB connection URL | - |
| `MAX_RETRIES` | Max reconnection attempts | `5` |
| `RETRY_DELAY` | Initial retry delay (ms) | `15000` |

## 🏗️ Architecture

### System Components

```
┌─────────────────┐
│   Frontend      │
│   (Socket.IO)   │
└────────┬────────┘
         │
┌────────▼────────┐
│  Express Server │
│   (REST API)    │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
┌───▼───┐ ┌──▼───┐
│ WhatsApp│ │Redis │
│Sessions │ │Queue │
└────────┘ └──────┘
```

### Key Features

1. **Multi-User Support**: Each user has isolated WhatsApp session
2. **AI Integration**: DeepSeek AI with fallback responses
3. **Performance Tracking**: Detailed employee metrics
4. **Message Queue**: Reliable message delivery with retries
5. **Auto-Reply Bot**: Configurable delay and smart responses
6. **Bulk Messaging**: Rate-limited bulk send capabilities
7. **Excel Import**: Client data import from Excel/CSV
8. **Real-time Updates**: Socket.IO for live status

## 🔐 Security Best Practices

1. **Strong JWT Secret**: Use minimum 32 character random string
2. **HTTPS Only**: Deploy behind HTTPS proxy in production
3. **Rate Limiting**: Configure appropriate limits for your use case
4. **Input Validation**: All user inputs are validated and sanitized
5. **Environment Variables**: Never commit `.env` file to version control
6. **Regular Updates**: Keep dependencies updated

## 🚢 Production Deployment

### Using PM2 (Recommended)

```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start server_fixed.js --name ragmcloud-crm

# Auto-restart on server reboot
pm2 startup
pm2 save

# Monitor
pm2 monit
```

### Using Docker

```dockerfile
FROM node:18-alpine

# Install Chromium
RUN apk add --no-cache chromium

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 10000

CMD ["node", "server_fixed.js"]
```

### Nginx Configuration

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:10000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## 📊 Monitoring

### Health Check Endpoint

```bash
curl http://localhost:10000/health
```

Response:
```json
{
  "status": "healthy",
  "uptime": 3600,
  "timestamp": 1234567890,
  "whatsappSessions": 5,
  "activeSessions": 3,
  "environment": "production"
}
```

### Logging

Logs are stored in `./logs/` directory:
- `error.log` - Error level logs
- `combined.log` - All logs

## 🔧 Troubleshooting

### WhatsApp Connection Issues

1. **QR Code not appearing**: Check Chrome/Chromium installation
2. **Session disconnects frequently**: Increase `MAX_RETRIES` and `RETRY_DELAY`
3. **Memory issues**: Ensure `SESSION_CLEANUP_INTERVAL_MINUTES` is configured

### Performance Issues

1. **Slow message sending**: Enable Redis queue for better performance
2. **High memory usage**: Reduce `MAX_MESSAGES_PER_CLIENT` value
3. **Database bottleneck**: Consider MongoDB for better scalability

## 🛠️ API Documentation

### Authentication

```bash
POST /api/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin123"
}
```

### Send Message

```bash
POST /api/send-message
Authorization: Bearer <token>
Content-Type: application/json

{
  "phone": "966555555555",
  "message": "Hello from Ragmcloud!"
}
```

### Bulk Send

```bash
POST /api/send-bulk
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "Bulk message",
  "delay": 40,
  "clients": [
    {"name": "Client 1", "phone": "966555555555"},
    {"name": "Client 2", "phone": "966555555556"}
  ]
}
```

## 📦 Dependencies

### Core Dependencies
- `express` - Web framework
- `socket.io` - Real-time communication
- `whatsapp-web.js` - WhatsApp Web API
- `winston` - Logging
- `bull` - Message queue
- `helmet` - Security headers
- `express-rate-limit` - Rate limiting
- `express-validator` - Input validation

## 🤝 Support

For issues or questions:
- Email: support@ragmcloud.sa
- Phone:  Phone: +966555111222
- Website: https://ragmcloud.sa

## 📄 License

© 2024 Ragmcloud ERP. All rights reserved.

## ⚠️ Important Notes

1. **Default Admin**: Username: `admin`, Password: `admin123` (Change immediately!)
2. **DeepSeek API**: Required for AI responses, fallback available
3. **Redis**: Optional but recommended for production
4. **Chrome**: Required for WhatsApp Web automation
5. **Session Storage**: Stored in `./sessions` directory

## 🔄 Update Instructions

```bash
# Backup current installation
cp -r . ../ragmcloud-backup

# Pull updates
git pull

# Install new dependencies
npm install

# Restart application
pm2 restart ragmcloud-crm
```

## 🚀 Performance Tips

1. Enable Redis for message queue
2. Use MongoDB for data persistence
3. Configure appropriate rate limits
4. Enable log rotation
5. Monitor memory usage
6. Regular session cleanup
7. Use PM2 for process management

---

Built with ❤️ by Ragmcloud Team
