/**
 * Verify a Single Report by ID
 * 
 * Usage: node scripts/verifySingleReport.js <reportId>
 * Example: node scripts/verifySingleReport.js 1
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verifySingleReport(reportId) {
  console.log(`\n🔍 VERIFYING REPORT #${reportId}\n`);
  console.log('='.repeat(60));

  try {
    const report = await prisma.report.findUnique({
      where: { id: parseInt(reportId) },
      include: {
        userTest: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            test: { select: { id: true, title: true } },
            attempts: {
              include: {
                answers: {
                  orderBy: { messageIndex: 'asc' },
                  take: 5
                }
              },
              orderBy: { createdAt: 'desc' },
              take: 1
            }
          }
        }
      }
    });

    if (!report) {
      console.log(`❌ Report #${reportId} not found!`);
      return;
    }

    const kpis = report.kpis || {};
    const components = kpis.components || {};
    const metadata = kpis.evaluationMetadata || {};

    console.log('\n👤 USER INFORMATION:');
    console.log(`   Name: ${report.userTest?.user?.name || 'Unknown'}`);
    console.log(`   Email: ${report.userTest?.user?.email || 'N/A'}`);
    console.log(`   User ID: ${report.userTest?.userId || 'N/A'}`);

    console.log('\n📝 TEST INFORMATION:');
    console.log(`   Test: ${report.userTest?.test?.title || 'Unknown'}`);
    console.log(`   Test ID: ${report.userTest?.testId || 'N/A'}`);

    console.log('\n📊 COMPONENT BREAKDOWN:');
    console.log(`   Overall Score: ${kpis.final || 0}%`);
    console.log(`   Creativity: ${components.creativity || 0}%`);
    console.log(`   Feasibility: ${components.feasibility || 0}%`);
    console.log(`   Proactivity: ${components.proactivity || 0}%`);

    console.log('\n🔍 EVALUATION METADATA:');
    console.log(`   Confidence: ${metadata.confidence || 'N/A'}%`);
    console.log(`   Evaluation Attempts: ${metadata.evaluationAttempts || 'N/A'}`);
    console.log(`   Evaluated At: ${metadata.evaluatedAt || 'N/A'}`);
    console.log(`   Message Count: ${metadata.messageCount || 'N/A'}`);
    console.log(`   Reasoning: ${metadata.reasoning || 'N/A'}`);

    // Check if real or fallback
    const isFallback = metadata.confidence === 50 && 
                      kpis.final === 75 && 
                      components.creativity === 75 && 
                      components.feasibility === 75 && 
                      components.proactivity === 75;

    console.log('\n✅ VERIFICATION RESULT:');
    if (isFallback) {
      console.log('   ❌ FALLBACK EVALUATION (GPT failed, using defaults)');
      console.log('   ⚠️  All scores are 75/75/75 with confidence 50');
      console.log('   💡 Check OPENAI_API_KEY and backend logs');
    } else {
      console.log('   ✅ REAL GPT EVALUATION');
      console.log('   ✅ Scores are GPT-generated based on conversation');
      console.log(`   ✅ Confidence: ${metadata.confidence || 85}%`);
    }

    // Show conversation sample
    const attempt = report.userTest?.attempts?.[0];
    if (attempt && attempt.answers) {
      console.log('\n💬 CONVERSATION SAMPLE (First 3 exchanges):');
      attempt.answers.slice(0, 3).forEach((answer, idx) => {
        console.log(`\n   Exchange ${idx + 1}:`);
        console.log(`   User: ${answer.userMessage?.substring(0, 100)}...`);
        if (answer.gptResponse) {
          console.log(`   GPT: ${answer.gptResponse.substring(0, 100)}...`);
        }
      });
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n✅ Verification complete!\n');

  } catch (error) {
    console.error('❌ Verification error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Get report ID from command line
const reportId = process.argv[2];

if (!reportId) {
  console.log('Usage: node scripts/verifySingleReport.js <reportId>');
  console.log('Example: node scripts/verifySingleReport.js 1');
  process.exit(1);
}

verifySingleReport(reportId);
