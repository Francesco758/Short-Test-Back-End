// test-email.js
require('dotenv').config();
const emailService = require('./services/emailService');

async function testEmail() {
  try {
    console.log('🧪 Testing email configuration...');
    
    // Test connection
    const isConnected = await emailService.verifyConnection();
    if (!isConnected) {
      console.log('❌ Email connection failed');
      return;
    }
    
    console.log('✅ Email service is ready!');
    console.log('📧 You can now test by assigning tests to users');
    console.log('🌐 Check emails at: https://ethereal.email');
    console.log('👤 Login with: voxqnclyx3gc477p@ethereal.email');
    console.log('🔑 Password: jttAvJtkVVbRfRCEWR');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testEmail();