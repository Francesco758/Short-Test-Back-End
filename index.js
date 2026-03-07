require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const fs = require('fs-extra');
const path = require('path');

// Import routes
const authRoutes = require('./routes/auth');
const conversationRoutes = require('./routes/conversation');
const promptRoutes = require('./routes/prompts');

// Admin routes
const adminCompanyRoutes = require('./routes/admin/companies');
const adminTestRoutes = require('./routes/admin/tests');
const adminUserRoutes = require('./routes/admin/users');
const adminDashboardRoutes = require('./routes/admin/dashboard');
const adminSettingsRoutes = require('./routes/admin/settings');

// Company routes
const companyUserRoutes = require('./routes/company/users.js');
const companyTestRoutes = require('./routes/company/tests.js');
const companyReportRoutes = require('./routes/company/reports.js');

// User routes
const userTestRoutes = require('./routes/user/tests.js');
const userProfileRoutes = require('./routes/user/profile.js');
const userReportRoutes = require('./routes/user/reports.js');

// Error handler
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = Number(process.env.PORT || 4000);

// Data directory setup - serverless compatible
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

// Check if we're on Vercel or other serverless platform
const isVercel = process.env.VERCEL === '1';
const isProduction = process.env.NODE_ENV === 'production';

// Only create directory locally, not in serverless environments
if (!isVercel && !isProduction) {
  try {
    fs.ensureDirSync(DATA_DIR);
    console.log(`📁 Data folder: ${DATA_DIR}`);
  } catch (err) {
    console.warn(`⚠️ Could not create data directory: ${err.message}`);
  }
} else if (isVercel) {
  console.log('📁 Data directory setup skipped (Vercel serverless environment)');
  console.log('💡 Note: For file storage, use /tmp directory or external services');
}

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan(isProduction ? 'combined' : 'dev'));

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'RPLT Backend API',
    status: 'running',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    documentation: 'API documentation available at /api/health',
    timestamp: new Date().toISOString()
  });
});

// Health check for deployment platforms
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'RPLT Backend is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    platform: isVercel ? 'Vercel' : 'Local/Other'
  });
});

// Test database connection endpoint
app.get('/api/test-db', async (req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    
    // Test simple query
    await prisma.$queryRaw`SELECT 1`;
    
    // Get some stats if possible
    const userCount = await prisma.user.count().catch(() => 'N/A');
    const companyCount = await prisma.company.count().catch(() => 'N/A');
    
    await prisma.$disconnect();
    
    res.json({ 
      database: 'Connected successfully',
      status: 'OK',
      stats: {
        users: userCount,
        companies: companyCount
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Database connection error:', error);
    res.status(500).json({ 
      database: 'Connection failed', 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Your existing health check (optional - can be removed if redundant)
app.get('/health', (req, res) => res.json({ 
  status: 'ok', 
  now: new Date().toISOString(),
  version: '1.0.0',
  environment: process.env.NODE_ENV || 'development'
}));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/conversation', conversationRoutes);
app.use('/api/prompts', promptRoutes);

// Admin routes
app.use('/api/admin/companies', adminCompanyRoutes);
app.use('/api/admin/tests', adminTestRoutes);
app.use('/api/admin/users', adminUserRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);
app.use('/api/admin/settings', adminSettingsRoutes);

// Company routes
app.use('/api/company/users', companyUserRoutes);
app.use('/api/company/tests', companyTestRoutes);
app.use('/api/company/reports', companyReportRoutes);

// User routes
app.use('/api/user/tests', userTestRoutes);
app.use('/api/user/profile', userProfileRoutes);
app.use('/api/user/reports', userReportRoutes);

// 404 handler
app.use((req, res) => res.status(404).json({ 
  error: 'Route not found',
  path: req.path,
  method: req.method,
  timestamp: new Date().toISOString()
}));

// Global error handler
app.use(errorHandler);

// Start server - conditional for Vercel
if (isVercel) {
  // Export for Vercel serverless
  module.exports = app;
} else {
  // Start local server
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
🚀 API server running on http://localhost:${PORT}
📁 Data folder: ${DATA_DIR} (creation ${!isVercel && !isProduction ? 'attempted' : 'skipped'})
🌐 Environment: ${process.env.NODE_ENV || 'development'}
📍 Health check: http://localhost:${PORT}/api/health
🗄️  DB test: http://localhost:${PORT}/api/test-db
${isVercel ? '☁️  Platform: Vercel Serverless' : '💻 Platform: Local Server'}
    `);
  });

  // Graceful shutdown for local server
  function shutdown(signal) {
    console.log(`\n📭 Received ${signal}. Shutting down gracefully...`);
    server.close(() => {
      console.log('✅ HTTP server closed.');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('❌ Could not close connections in time, forcing shutdown');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
