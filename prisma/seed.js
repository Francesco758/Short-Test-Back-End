const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function safeDeleteMany(model) {
  try {
    await prisma[model].deleteMany({});
    console.log(`✅ Deleted ${model}`);
  } catch (error) {
    // If table doesn't exist, just continue
    if (error.code === 'P2021') {
      console.log(`⚠️  Table ${model} doesn't exist, skipping`);
    } else {
      throw error;
    }
  }
}

async function main() {
  console.log('🌱 Starting database seed...');

  // ===========================
  // 0. SAFE CLEANUP - Handle missing tables gracefully
  // ===========================
  console.log('🧹 Safe cleanup...');
  
  // Delete in reverse order of dependencies, safely
  await safeDeleteMany('gPTMessage');
  await safeDeleteMany('testAnswer');
  await safeDeleteMany('testAttempt');
  await safeDeleteMany('report');
  await safeDeleteMany('userTest');
  await safeDeleteMany('companyTest');
  await safeDeleteMany('test');
  await safeDeleteMany('user');
  await safeDeleteMany('company');

  console.log('✅ Cleanup completed');

  // ===========================
  // 1. SUPER ADMIN
  // ===========================
  const adminPassword = await bcrypt.hash('Admin123!', 10);
  const admin = await prisma.user.create({
    data: {
      email: 'admin@shortest.local',
      password: adminPassword,
      role: 'SUPER_ADMIN',
      name: 'Super Admin',
      createdByAdmin: false
    }
  });
  console.log('✅ Super Admin:', admin.email);

  // ===========================
  // 2. SAMPLE COMPANIES
  // ===========================
  const sampleCompany1 = await prisma.company.create({
    data: {
      name: 'Tech Innovations Inc',
      description: 'Leading technology solutions provider'
    }
  });
  console.log('✅ Company 1:', sampleCompany1.name);

  const sampleCompany2 = await prisma.company.create({
    data: {
      name: 'Business Solutions Ltd',
      description: 'Business process optimization experts'
    }
  });
  console.log('✅ Company 2:', sampleCompany2.name);

  // ===========================
  // 3. COMPANY ADMINS
  // ===========================
  const companyAdmin1Password = await bcrypt.hash('Manager123!', 10);
  const companyAdmin1 = await prisma.user.create({
    data: {
      email: 'admin@techinnovations.com',
      password: companyAdmin1Password,
      role: 'COMPANY_ADMIN',
      name: 'Tech Innovations Admin',
      companyId: sampleCompany1.id,
      createdByAdmin: true
    }
  });
  console.log('✅ Company Admin 1:', companyAdmin1.email);

  const companyAdmin2Password = await bcrypt.hash('Manager123!', 10);
  const companyAdmin2 = await prisma.user.create({
    data: {
      email: 'admin@businesssolutions.com',
      password: companyAdmin2Password,
      role: 'COMPANY_ADMIN',
      name: 'Business Solutions Admin',
      companyId: sampleCompany2.id,
      createdByAdmin: true
    }
  });
  console.log('✅ Company Admin 2:', companyAdmin2.email);

  // ===========================
  // 4. DEFAULT TEST - SIMPLIFIED DYNAMIC ASSESSMENT
  // ===========================
  
  const defaultTest = await prisma.test.create({
    data: {
      title: 'Leadership & Change Management Assessment',
      description: 'A dynamic, conversational assessment that evaluates problem-solving skills, creative thinking, practical planning, and leadership potential through natural dialogue',
      systemPrompt: `You are an expert conversational interviewer conducting a behavioral assessment. Your goal is to guide a natural, flowing conversation that evaluates the participant's:

1. **Problem-Solving Skills** - Understanding and approach to challenges
2. **Creative Thinking** - Innovative solutions and perspectives  
3. **Practical Feasibility** - Realistic implementation planning
4. **Proactive Mindset** - Initiative and forward-thinking

CONVERSATION GUIDELINES:
- Start with a warm introduction and explain the assessment
- Ask the participant to describe a current work challenge or improvement opportunity
- Ask open-ended questions that encourage detailed responses
- Build on their answers naturally - don't follow a rigid script
- Adapt your questions based on their responses
- Use follow-up questions to dig deeper into interesting points
- Keep the conversation professional but friendly
- Guide them through discussing:
  * The challenge they're facing
  * Root causes and contributing factors
  * Potential solutions and approaches
  * Implementation planning and stakeholder considerations
  * Success metrics and learning opportunities

IMPORTANT INSTRUCTIONS:
- Let the conversation flow naturally - adapt to the user's responses
- You can use lists, bullet points, or markdown formatting in your responses
- Ask clarifying questions when needed
- Provide thoughtful transitions between topics
- Aim for 8-12 meaningful exchanges to thoroughly assess their capabilities
- When you feel the assessment is complete (after substantial discussion covering all areas), clearly state: "This assessment is now complete. Thank you for your thoughtful participation."

Begin by introducing yourself and the assessment, then start the conversation naturally.`,
      status: 'ACTIVE',
      createdById: admin.id,
      settings: {
        estimatedDuration: '15-20 minutes',
        evaluationCriteria: ['Problem Analysis', 'Creative Thinking', 'Implementation Planning', 'Stakeholder Management']
      }
    }
  });
  console.log('✅ Default Test: Leadership & Change Management Assessment');

  // ===========================
  // 5. ASSIGN TEST TO COMPANIES (Optional - for initial testing)
  // ===========================
  await prisma.companyTest.createMany({
    data: [
      {
        companyId: sampleCompany1.id,
        testId: defaultTest.id,
        assignedById: admin.id
      },
      {
        companyId: sampleCompany2.id,
        testId: defaultTest.id,
        assignedById: admin.id
      }
    ],
    skipDuplicates: true
  });
  console.log('✅ Test assigned to companies');

  // ===========================
  // 6. SAMPLE USERS FOR COMPANIES
  // ===========================
  const userPassword = await bcrypt.hash('User123!', 10);
  
  // Company 1 Users
  const company1Users = await Promise.all([
    prisma.user.create({
      data: {
        email: 'user1@techinnovations.com',
        password: userPassword,
        role: 'USER',
        name: 'John Developer',
        companyId: sampleCompany1.id
      }
    }),
    prisma.user.create({
      data: {
        email: 'user2@techinnovations.com',
        password: userPassword,
        role: 'USER',
        name: 'Sarah Manager', 
        companyId: sampleCompany1.id
      }
    })
  ]);
  console.log('✅ Company 1 users created');

  // Company 2 Users
  const company2Users = await Promise.all([
    prisma.user.create({
      data: {
        email: 'user1@businesssolutions.com',
        password: userPassword,
        role: 'USER',
        name: 'Mike Analyst',
        companyId: sampleCompany2.id
      }
    })
  ]);
  console.log('✅ Company 2 users created');

  // ===========================
  // 7. ASSIGN TEST TO USERS
  // ===========================
  await prisma.userTest.createMany({
    data: [
      // Company 1 users
      {
        userId: company1Users[0].id,
        testId: defaultTest.id,
        companyId: sampleCompany1.id,
        status: 'ASSIGNED'
      },
      {
        userId: company1Users[1].id,
        testId: defaultTest.id,
        companyId: sampleCompany1.id,
        status: 'ASSIGNED'
      },
      // Company 2 user
      {
        userId: company2Users[0].id,
        testId: defaultTest.id,
        companyId: sampleCompany2.id,
        status: 'ASSIGNED'
      }
    ],
    skipDuplicates: true
  });
  console.log('✅ Test assigned to users');

  console.log('✅ Database seeding completed!');

  // ===========================
  // 8. DISPLAY SUMMARY
  // ===========================
  console.log('\n📊 SEEDING SUMMARY:');
  console.log('==================');
  console.log(`✅ Super Admin: ${admin.email} (Password: Admin123!)`);
  console.log(`✅ Company 1 Admin: ${companyAdmin1.email} (Password: Manager123!)`);
  console.log(`✅ Company 2 Admin: ${companyAdmin2.email} (Password: Manager123!)`);
  console.log(`✅ Company 1 Users: ${company1Users.map(u => u.email).join(', ')} (Password: User123!)`);
  console.log(`✅ Company 2 Users: ${company2Users.map(u => u.email).join(', ')} (Password: User123!)`);
  console.log(`\n🎯 Default Test: ${defaultTest.title}`);
  console.log(`📝 Description: ${defaultTest.description}`);
  console.log(`📋 Status: ${defaultTest.status} (Ready to use!)`);
  console.log('\n🚀 Ready to start the application!');
  console.log('\n📍 TESTING FLOW:');
  console.log('1. Login as Super Admin → Go to /dashboard/tests');
  console.log('2. View default test → Edit or use as-is');
  console.log('3. Assign to companies (already assigned to both sample companies)');
  console.log('4. Users can take test at /test');
  console.log('5. Natural, GPT-guided conversation');
  console.log('\n💡 The default test is already assigned to all sample users!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });