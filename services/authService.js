const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { prisma } = require('../utils/prismaClient');

const SECRET = process.env.JWT_SECRET || 'devsecret';
const TOKEN_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

async function register(payload) {
  const { email, password, name, companyName, organizationType, organizationSize, country, role } = payload;

  if (!email || !password) {
    const err = new Error('Email and password are required');
    err.status = 400;
    throw err;
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existingUser = await prisma.user.findFirst({ where: { email: normalizedEmail } });
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

    // Validate organizationType if provided, default to COMPANY
    const validOrgTypes = ['COMPANY', 'TEAM', 'UNIVERSITY', 'CLASSROOM'];
    const orgType = organizationType && validOrgTypes.includes(organizationType.toUpperCase())
      ? organizationType.toUpperCase()
      : 'COMPANY';

    const company = await prisma.company.create({
      data: {
        name: companyName,
        organizationType: orgType,
        organizationSize: organizationSize || null,
        country: country || null
      }
    });
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
      email: normalizedEmail,
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

  // Auto-assign "Custom Test" and "Problem Solution Discovery" to newly registered companies
  if (companyId) {
    try {
      const autoAssignTests = await prisma.test.findMany({
        where: {
          title: { in: ['Custom Test', 'Problem Solution Discovery'] },
          deletedAt: null
        }
      });

      for (const test of autoAssignTests) {
        const alreadyAssigned = await prisma.companyTest.findUnique({
          where: {
            companyId_testId: {
              companyId: companyId,
              testId: test.id
            }
          }
        });

        if (!alreadyAssigned) {
          await prisma.companyTest.create({
            data: {
              testId: test.id,
              companyId: companyId,
              assignedById: newUser.id
            }
          });
        }
      }
    } catch (autoAssignErr) {
      // Silently fail - don't block registration if auto-assignment fails
      console.error('Auto-assignment error:', autoAssignErr);
    }
  }

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

  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findFirst({ 
    where: { email: normalizedEmail }, 
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

async function guestLogin(payload) {
  const { name, companyId } = payload;

  if (!name || !name.trim()) {
    const err = new Error('Name is required');
    err.status = 400;
    throw err;
  }

  if (!companyId) {
    const err = new Error('Company ID is required');
    err.status = 400;
    throw err;
  }

  const normalizedGuestName = name.trim().replace(/\s+/g, ' ').toLowerCase();
  const cId = parseInt(companyId);

  // Check if guest with same name + company already exists (reuse it)
  let guestUser = await prisma.user.findFirst({
    where: { name: normalizedGuestName, companyId: cId, isGuest: true, deletedAt: null },
    include: { company: true }
  });

  if (!guestUser) {
    // Generate a unique synthetic email
    const shortId = Math.random().toString(36).substring(2, 8);
    const syntheticEmail = `guest_${cId}_${shortId}@rplt.guest`;

    guestUser = await prisma.user.create({
      data: {
        email: syntheticEmail,
        name: normalizedGuestName,
        role: 'GUEST',
        isGuest: true,
        companyId: cId
      },
      include: { company: true }
    });
  }

  // Update last login
  await prisma.user.update({
    where: { id: guestUser.id },
    data: { lastLoginAt: new Date() }
  });

  const tokenPayload = {
    id: guestUser.id,
    email: guestUser.email,
    role: guestUser.role,
    companyId: guestUser.companyId,
    isGuest: true
  };

  const token = jwt.sign(tokenPayload, SECRET, { expiresIn: TOKEN_EXPIRES });

  const { password: _, ...safeUser } = guestUser;
  return { token, user: safeUser, message: 'Guest login successful' };
}

module.exports = { 
  register, 
  login, 
  getMe, 
  changePassword,
  guestLogin
};