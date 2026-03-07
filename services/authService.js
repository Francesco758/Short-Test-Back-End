const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { prisma } = require('../utils/prismaClient');

const SECRET = process.env.JWT_SECRET || 'devsecret';
const TOKEN_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

async function register(payload) {
  const { email, password, name, companyName, role } = payload;
  
  if (!email || !password) {
    const err = new Error('Email and password are required');
    err.status = 400;
    throw err;
  }

  const existingUser = await prisma.user.findUnique({ where: { email: email.trim() } });
  if (existingUser) {
    const err = new Error('User already exists');
    err.status = 409;
    throw err;
  }

  let companyId = null;
  let companyData = null;
  
  // If company name provided, create company and set user as COMPANY_ADMIN
  if (companyName) {
    const existingCompany = await prisma.company.findUnique({ where: { name: companyName } });
    if (existingCompany) {
      const err = new Error('Company name already exists');
      err.status = 409;
      throw err;
    }
    const company = await prisma.company.create({ data: { name: companyName } });
    companyId = company.id;
    companyData = company;
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  
  // Determine role: SUPER_ADMIN (first user), COMPANY_ADMIN (with company), or USER
  let userRole = 'USER';
  if (companyName) {
    userRole = 'COMPANY_ADMIN';
  } else {
    // Check if this is the first user (SUPER_ADMIN)
    const userCount = await prisma.user.count();
    if (userCount === 0) {
      userRole = 'SUPER_ADMIN';
    } else if (role && ['SUPER_ADMIN', 'COMPANY_ADMIN', 'USER'].includes(role.toUpperCase())) {
      userRole = role.toUpperCase();
    }
  }

  const newUser = await prisma.user.create({
    data: {
      email: email.trim(),
      password: hashedPassword,
      role: userRole,
      name: name ? name.trim() : null,
      companyId: companyId,
      createdByAdmin: !companyName // Track if created by admin (no company)
    },
    include: { company: true }
  });

  const tokenPayload = {
    id: newUser.id,
    email: newUser.email,
    role: newUser.role,
    companyId: newUser.companyId
  };

  const token = jwt.sign(tokenPayload, SECRET, { expiresIn: TOKEN_EXPIRES });

  const { password: _, ...safeUser } = newUser;
  const userResponse = { ...safeUser, company: companyData || newUser.company || null };

  return { 
    token, 
    user: userResponse, 
    message: companyName ? 'Company account created successfully' : 'User account created successfully' 
  };
}

async function login(payload) {
  const { email, password } = payload;
  if (!email || !password) {
    const err = new Error('Email and password are required');
    err.status = 400;
    throw err;
  }

  const user = await prisma.user.findUnique({ 
    where: { email: email.trim() }, 
    include: { company: true } 
  });
  
  if (!user || user.deletedAt) {
    const err = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }

  let isPasswordValid = false;

  // ✅ ONLY FOR USER ROLE: Compare plain text passwords
  if (user.role === 'USER') {
    console.log('👤 USER role - plain text password comparison');
    isPasswordValid = (password === user.password);
  } else {
    // ✅ For SUPER_ADMIN and COMPANY_ADMIN: Keep existing bcrypt logic
    console.log('👑 ADMIN role - bcrypt comparison');
    isPasswordValid = await bcrypt.compare(password, user.password);
  }

  if (!isPasswordValid) {
    const err = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }

  // Update last login (keep existing logic)
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() }
  });

  const tokenPayload = {
    id: user.id,
    email: user.email,
    role: user.role,
    companyId: user.companyId
  };

  const token = jwt.sign(tokenPayload, SECRET, { expiresIn: TOKEN_EXPIRES });

  const { password: _, ...safeUser } = user;
  return { token, user: safeUser, message: 'Login successful' };
}

async function getMe(tokenPayload) {
  if (!tokenPayload || !tokenPayload.id) return null;
  const user = await prisma.user.findUnique({ 
    where: { id: tokenPayload.id }, 
    include: { company: true } 
  });
  if (!user) return null;
  const { password: _, ...safeUser } = user;
  return safeUser;
}

async function changePassword(userId, payload) {
  const { currentPassword, newPassword } = payload;
  
  if (!currentPassword || !newPassword) {
    const err = new Error('Current password and new password are required');
    err.status = 400;
    throw err;
  }

  if (newPassword.length < 6) {
    const err = new Error('New password must be at least 6 characters long');
    err.status = 400;
    throw err;
  }

  // Get user with password
  const user = await prisma.user.findUnique({ 
    where: { id: userId } 
  });
  
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  // Verify current password
  const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
  if (!isCurrentPasswordValid) {
    const err = new Error('Current password is incorrect');
    err.status = 401;
    throw err;
  }

  // Hash new password
  const hashedNewPassword = await bcrypt.hash(newPassword, 10);

  // Update password
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { password: hashedNewPassword },
    select: { id: true, email: true, role: true, name: true, companyId: true } // Don't return password
  });

  return { 
    message: 'Password changed successfully',
    user: updatedUser
  };
}

module.exports = { 
  register, 
  login, 
  getMe, 
  changePassword 
};