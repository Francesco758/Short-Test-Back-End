/**
 * Verification Script for Component Breakdown Values
 * 
 * Run: node scripts/verifyReports.js
 * 
 * This script checks if Component Breakdown scores are real GPT-generated values
 * or fallback defaults.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verifyReports() {
  console.log('\n🔍 VERIFYING COMPONENT BREAKDOWN VALUES\n');
  console.log('=' .repeat(60));

  try {
    // Get recent reports
    const reports = await prisma.report.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        userTest: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            test: { select: { id: true, title: true } }
          }
        }
      }
    });

    if (reports.length === 0) {
      console.log('❌ No reports found. Complete some tests first!');
      return;
    }

    console.log(`\n📊 Found ${reports.length} recent reports:\n`);

    let realCount = 0;
    let fallbackCount = 0;

    reports.forEach((report, index) => {
      const kpis = report.kpis || {};
      const components = kpis.components || {};
      const metadata = kpis.evaluationMetadata || {};
      
      const overallScore = kpis.final || 0;
      const creativity = components.creativity || 0;
      const feasibility = components.feasibility || 0;
      const proactivity = components.proactivity || 0;
      const confidence = metadata.confidence || 0;
      const attempts = metadata.evaluationAttempts || 0;
      const reasoning = metadata.reasoning || 'N/A';

      // Determine if real or fallback
      const isFallback = confidence === 50 && 
                        overallScore === 75 && 
                        creativity === 75 && 
                        feasibility === 75 && 
                        proactivity === 75;

      if (isFallback) {
        fallbackCount++;
      } else {
        realCount++;
      }

      console.log(`\n📋 Report #${index + 1} (ID: ${report.id})`);
      console.log(`   User: ${report.userTest?.user?.name || 'Unknown'} (${report.userTest?.user?.email || 'N/A'})`);
      console.log(`   Test: ${report.userTest?.test?.title || 'Unknown'}`);
      console.log(`   Created: ${new Date(report.createdAt).toLocaleString()}`);
      console.log(`\n   📊 Component Scores:`);
      console.log(`      Overall: ${overallScore}%`);
      console.log(`      Creativity: ${creativity}%`);
      console.log(`      Feasibility: ${feasibility}%`);
      console.log(`      Proactivity: ${proactivity}%`);
      console.log(`\n   🔍 Evaluation Metadata:`);
      console.log(`      Confidence: ${confidence}% ${confidence >= 80 ? '✅' : confidence >= 60 ? '⚠️' : '❌'}`);
      console.log(`      Attempts: ${attempts}`);
      console.log(`      Reasoning: ${reasoning.substring(0, 80)}...`);
      console.log(`\n   ${isFallback ? '❌ FALLBACK (GPT failed)' : '✅ REAL (GPT generated)'}`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('\n📈 SUMMARY:');
    console.log(`   ✅ Real GPT Evaluations: ${realCount}`);
    console.log(`   ❌ Fallback Evaluations: ${fallbackCount}`);
    console.log(`   📊 Total Reports: ${reports.length}`);
    
    if (fallbackCount > 0) {
      console.log('\n⚠️  WARNING: Some reports used fallback values.');
      console.log('   Check OPENAI_API_KEY and network connectivity.');
    } else {
      console.log('\n✅ All reports are using real GPT-generated scores!');
    }

    // Check for score variations (indicates real evaluation)
    const allScores = reports.map(r => ({
      creativity: r.kpis?.components?.creativity || 0,
      feasibility: r.kpis?.components?.feasibility || 0,
      proactivity: r.kpis?.components?.proactivity || 0
    }));

    const uniqueScores = new Set();
    allScores.forEach(s => {
      uniqueScores.add(`${s.creativity}-${s.feasibility}-${s.proactivity}`);
    });

    console.log(`\n🎯 Score Diversity: ${uniqueScores.size} unique score combinations`);
    if (uniqueScores.size === 1 && reports.length > 1) {
      console.log('   ⚠️  All scores are identical - might indicate an issue');
    } else {
      console.log('   ✅ Scores vary - indicates real evaluation');
    }

  } catch (error) {
    console.error('❌ Verification error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run verification
verifyReports();
