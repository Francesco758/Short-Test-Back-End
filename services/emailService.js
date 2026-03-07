// services/emailService.js
const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendTestAssignmentEmail(user, test, companyName, loginUrl, userPassword) {
    const subject = `${companyName} - New Test Assignment: ${test.title}`;
    const html = this.generateEmailTemplate(user, test, companyName, loginUrl, userPassword, false);
    
    await this.sendEmail(user.email, subject, html);
  }

  async sendBulkTestAssignmentEmail(user, tests, companyName, loginUrl, userPassword) {
    const subject = `${companyName} - New Test Assignments: ${tests.length} Tests`;
    const html = this.generateEmailTemplate(user, tests, companyName, loginUrl, userPassword, true);
    
    await this.sendEmail(user.email, subject, html);
  }

  generateEmailTemplate(user, testOrTests, companyName, loginUrl, userPassword, isBulk = false) {
    const tests = isBulk ? testOrTests : [testOrTests];
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Test Assignment - ${companyName}</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            line-height: 1.6; 
            color: #374151; 
            margin: 0; 
            padding: 0; 
            background: linear(135deg, #f8fafc 0%, #f1f5f9 100%);
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }
          
          .container { 
            max-width: 600px; 
            margin: 0 auto; 
            background: white;
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 
              0 20px 25px -5px rgba(0, 0, 0, 0.1),
              0 10px 10px -5px rgba(0, 0, 0, 0.04);
            border: 1px solid #e2e8f0;
          }
          
          .header { 
            background: linear(135deg, #667eea 0%, #764ba2 100%);
            color: white; 
            padding: 40px 32px; 
            text-align: center;
            position: relative;
            overflow: hidden;
          }
          
          .header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 100" fill="rgba(255,255,255,0.1)"><polygon points="0,0 1000,100 0,100"/></svg>');
            background-size: cover;
          }
          
          .header-content {
            position: relative;
            z-index: 2;
          }
          
          .header h1 {
            margin: 0;
            font-size: 28px;
            font-weight: 700;
            letter-spacing: -0.025em;
          }
          
          .company-name {
            font-size: 16px;
            opacity: 0.9;
            margin-top: 12px;
            font-weight: 500;
            letter-spacing: 0.025em;
          }
          
          .badge {
            display: inline-block;
            background: rgba(255, 255, 255, 0.2);
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
            margin-top: 16px;
            backdrop-filter: blur(10px);
          }
          
          .content { 
            padding: 40px 32px; 
          }
          
          .greeting {
            font-size: 20px;
            color: #111827;
            margin-bottom: 24px;
            font-weight: 600;
            line-height: 1.4;
          }
          
          .greeting strong {
            color: #4f46e5;
            font-weight: 700;
          }
          
          .intro-text {
            color: #6b7280;
            font-size: 16px;
            margin-bottom: 32px;
            line-height: 1.7;
          }
          
          .tests-section {
            margin: 32px 0;
          }
          
          .section-title {
            font-size: 18px;
            font-weight: 600;
            color: #1f2937;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 12px;
          }
          
          .section-title::before {
            content: '';
            width: 4px;
            height: 20px;
            background: linear(135deg, #4f46e5, #7e22ce);
            border-radius: 2px;
          }
          
          .test-card {
            background: linear(135deg, #f8fafc 0%, #f1f5f9 100%);
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            padding: 24px;
            margin: 16px 0;
            transition: all 0.3s ease;
            border-left: 4px solid #4f46e5;
          }
          
          .test-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px -5px rgba(0, 0, 0, 0.1);
            border-left-color: #7e22ce;
          }
          
          .test-title {
            font-size: 18px;
            font-weight: 600;
            color: #1e293b;
            margin: 0 0 12px 0;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          
          .test-title::before {
            content: '📝';
            font-size: 16px;
          }
          
          .test-description {
            color: #64748b;
            font-size: 15px;
            margin: 0;
            line-height: 1.6;
          }
          
          .credentials { 
            background: linear(135deg, #f0f9ff 0%, #e0f2fe 100%);
            padding: 28px; 
            border-radius: 16px; 
            border: 1px solid #bae6fd;
            margin: 32px 0; 
            position: relative;
            overflow: hidden;
          }
          
          .credentials::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 4px;
            height: 100%;
            background: linear(135deg, #0ea5e9, #0369a1);
          }
          
          .credentials h3 {
            margin: 0 0 20px 0; 
            color: #0c4a6e;
            font-size: 18px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          
          .credentials h3::before {
            content: '🔑';
          }
          
          .credential-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 16px;
          }
          
          @media (min-width: 480px) {
            .credential-grid {
              grid-template-columns: 1fr 1fr;
            }
          }
          
          .credential-item {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          
          .credential-label {
            font-weight: 600;
            color: #0f766e;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          
          .credential-value {
            color: #1e293b;
            font-size: 15px;
            font-weight: 500;
            word-break: break-all;
          }
          
          .security-note {
            background: linear(135deg, #fef3c7 0%, #fef7cd 100%);
            border: 1px solid #f59e0b;
            border-radius: 12px;
            padding: 20px;
            margin: 24px 0;
            font-size: 14px;
            color: #92400e;
            display: flex;
            align-items: flex-start;
            gap: 12px;
            line-height: 1.6;
          }
          
          .security-note::before {
            content: '🔒';
            font-size: 16px;
            flex-shrink: 0;
            margin-top: 2px;
          }
          
          .cta-section {
            text-align: center;
            margin: 32px 0;
            padding: 32px 0;
            border-top: 1px solid #f1f5f9;
            border-bottom: 1px solid #f1f5f9;
          }
          
         .button { 
  background-color: #4f46e5; /* Solid fallback for email clients */
  background: linear-gradient(135deg, #4f46e5 0%, #7e22ce 100%); /* Gradient for supported clients */
  color: #ffffff !important; 
  padding: 16px 40px; 
  text-decoration: none; 
  border-radius: 8px; /* Reduced radius for better support */
  display: inline-block; 
  font-weight: 600;
  font-size: 16px;
  text-align: center;
  border: 2px solid #4f46e5; /* Border as additional fallback */
  mso-padding-alt: 0px; /* Outlook specific fix */
  -webkit-text-size-adjust: none; /* Prevent iOS zoom */
  text-size-adjust: none;
}
          
          .button:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px -5px rgba(79, 70, 229, 0.6);
            background: linear(135deg, #4338ca 0%, #6b21a8 100%);
          }
          
          .button:active {
            transform: translateY(0);
          }
          
          .footer {
            margin-top: 40px;
            padding-top: 32px;
            border-top: 1px solid #e5e7eb;
            color: #6b7280;
            font-size: 14px;
            text-align: center;
            line-height: 1.6;
          }
          
          .footer p {
            margin: 8px 0;
          }
          
          .company-signature {
            color: #4b5563;
            font-weight: 600;
            margin-top: 16px;
          }
          
          /* Responsive Design */
          @media (max-width: 640px) {
            .container {
              margin: 16px;
              border-radius: 16px;
            }
            
            .header {
              padding: 32px 24px;
            }
            
            .header h1 {
              font-size: 24px;
            }
            
            .content {
              padding: 32px 24px;
            }
            
            .greeting {
              font-size: 18px;
            }
            
            .test-card {
              padding: 20px;
            }
            
            .credentials {
              padding: 24px;
            }
            
            .button {
              padding: 14px 32px;
              width: 100%;
              max-width: 280px;
            }
          }
          
          @media (max-width: 480px) {
            .header {
              padding: 28px 20px;
            }
            
            .content {
              padding: 28px 20px;
            }
            
            .header h1 {
              font-size: 22px;
            }
            
            .test-card {
              padding: 16px;
            }
            
            .credential-grid {
              grid-template-columns: 1fr;
            }
          }
          
          /* Dark mode support */
          @media (prefers-color-scheme: dark) {
            body {
              background: linear(135deg, #0f172a 0%, #1e293b 100%);
            }
            
            .container {
              background: #1f2937;
              border-color: #374151;
            }
            
            .content {
              color: #d1d5db;
            }
            
            .greeting {
              color: #f9fafb;
            }
            
            .intro-text {
              color: #9ca3af;
            }
            
            .test-card {
              background: linear(135deg, #374151 0%, #4b5563 100%);
              border-color: #4b5563;
            }
            
            .test-title {
              color: #f9fafb;
            }
            
            .test-description {
              color: #d1d5db;
            }
            
            .footer {
              color: #9ca3af;
              border-color: #374151;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="header-content">
              <h1>${isBulk ? 'New Test Assignments' : 'Test Assignment'}</h1>
              <div class="company-name">${companyName}</div>
              <div class="badge">${isBulk ? `${tests.length} Tests Assigned` : '1 Test Assigned'}</div>
            </div>
          </div>
          
          <div class="content">
            <div class="greeting">
              Hello <strong>${user.name || 'there'}</strong>,
            </div>
            
            <p class="intro-text">
              You have been assigned ${isBulk ? `${tests.length} new tests` : 'a new test'} to complete. 
              Please use the credentials below to access your account and begin your assessment.
            </p>
            
            <div class="tests-section">
              <div class="section-title">Assigned Test${isBulk ? 's' : ''}</div>
              
              ${tests.map(test => `
                <div class="test-card">
                  <div class="test-title">${test.title}</div>
                  ${test.description ? `<div class="test-description">${test.description}</div>` : ''}
                </div>
              `).join('')}
            </div>
            
            <div class="credentials">
              <h3>Your Login Credentials</h3>
              <div class="credential-grid">
                <div class="credential-item">
                  <span class="credential-label">Email</span>
                  <span class="credential-value">${user.email}</span>
                </div>
                <div class="credential-item">
                  <span class="credential-label">Password</span>
                  <span class="credential-value">${userPassword}</span>
                </div>
                <div class="credential-item">
                  <span class="credential-label">Login URL</span>
                  <span class="credential-value">${loginUrl}</span>
                </div>
              </div>
            </div>

            <div class="security-note">
              For security reasons, please keep your login credentials confidential and do not share them with anyone.
            </div>

            <div class="cta-section">
              <p style="margin-bottom: 20px; color: #6b7280; font-size: 15px;">
                Click the button below to access your account and start your assigned test${isBulk ? 's' : ''}:
              </p>
              <a href="${loginUrl}" class="button">Access Your Account</a>
            </div>
            
            <div class="footer">
              <p>If you have any questions or need assistance, please contact your company administrator.</p>
              <p>This is an automated message from ${companyName}. Please do not reply to this email.</p>
              <p class="company-signature">© 2024 ${companyName}. All rights reserved.</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  async sendEmail(to, subject, html) {
    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM || '"Test Platform" <noreply@testplatform.com>',
        to,
        subject,
        html,
      });
      console.log(`✅ Email sent successfully to: ${to}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to send email to ${to}:`, error);
      throw error;
    }
  }

  // Verify email configuration
  async verifyConnection() {
    try {
      await this.transporter.verify();
      console.log('✅ Email server connection verified');
      return true;
    } catch (error) {
      console.error('❌ Email server connection failed:', error);
      return false;
    }
  }
}

module.exports = new EmailService();