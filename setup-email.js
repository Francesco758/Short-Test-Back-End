const nodemailer = require('nodemailer');

async function setupTestEmail() {
  try {
    const testAccount = await nodemailer.createTestAccount();
    
    console.log('✅ Test email account created!');
    console.log('📧 Email:', testAccount.user);
    console.log('🔑 Password:', testAccount.pass);
    console.log('🌐 Web Interface: https://ethereal.email');
    console.log('\n📝 Add these to your .env file:');
    console.log(`SMTP_HOST=smtp.ethereal.email`);
    console.log(`SMTP_PORT=587`);
    console.log(`SMTP_USER=${testAccount.user}`);
    console.log(`SMTP_PASS=${testAccount.pass}`);
    
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
  }
}

setupTestEmail();