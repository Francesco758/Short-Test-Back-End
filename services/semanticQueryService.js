const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
let _parseCfg = { apiKey: process.env.OPENAI_API_KEY || '', model: process.env.OPENAI_STREAM_MODEL || 'gpt-4o-mini', loadedAt: 0 };

async function loadApiKey() {
  const now = Date.now();
  if (now - _parseCfg.loadedAt < 30000 && _parseCfg.apiKey) return;
  try {
    const { prisma } = require('../utils/prismaClient');
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'openai_api_key' } });
    if (setting?.value) _parseCfg.apiKey = setting.value;
    _parseCfg.loadedAt = now;
  } catch { /* use defaults */ }
}

async function gptJson(messages, maxTokens = 600) {
  await loadApiKey();
  if (!_parseCfg.apiKey) throw new Error('OPENAI_API_KEY not configured');
  const body = {
    model: _parseCfg.model,
    messages,
    temperature: 0.0,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    stream: false
  };
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_parseCfg.apiKey}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${text}`);
  }
  const payload = await res.json();
  const content = payload.choices?.[0]?.message?.content || '{}';
  try {
    return JSON.parse(content);
  } catch {
    throw new Error('Failed to parse JSON from GPT response');
  }
}

const PARSE_SYSTEM = `You convert natural language questions into structured database query plans.
Respond with valid JSON only. No markdown, no code fences — raw JSON.`

function buildParsePrompt(question, summary, isAdmin) {
  const hasScores = summary.assignments?.some(a => a.score != null);
  const hasPending = summary.assignments?.some(a => a.status === 'ASSIGNED' || a.status === 'IN_PROGRESS');
  const userCount = summary.users?.length || 0;
  const testCount = summary.tests?.length || 0;

  const context = isAdmin
    ? `Platform-wide data (anonymized):
- ${summary.metrics?.totalCompanies || 0} companies
- ${summary.metrics?.totalUsers || 0} users
- ${summary.metrics?.totalTests || 0} tests
- ${summary.metrics?.totalAssignments || 0} assignments
- Average CKPI: ${summary.metrics?.avgFinal ?? 'N/A'}
- Completed: ${summary.metrics?.completed || 0}
- In progress: ${summary.metrics?.inProgress || 0}
Top companies by avg CKPI: ${summary.topCompaniesByScore?.slice(0, 3).map(c => `${c.label} (${c.avgScore})`).join(', ') || 'N/A'}`
    : `Company data:
- ${userCount} users
- ${testCount} tests assigned
- ${summary.metrics?.count || 0} total assignments
- ${summary.metrics?.completed || 0} completed
- ${summary.metrics?.inProgress || 0} in progress
- ${hasPending ? 'Some pending' : 'No pending'} assignments
- Average CKPI: ${summary.metrics?.avgFinal ?? 'N/A'}
- ${hasScores ? summary.assignments.filter(a => a.score != null).length + ' assignments have scores' : 'No scored assignments yet'}
- Deadlines: ${summary.deadlines?.length || 0} upcoming
- Recent completions: ${summary.recentReports?.length || 0} last reports
- CKPI Components - Critical Thinking: ${summary.ckpiMetrics?.averages?.criticalThinking ?? 'N/A'}, Creativity: ${summary.ckpiMetrics?.averages?.originality ?? 'N/A'}, Feasibility: ${summary.ckpiMetrics?.averages?.feasibility ?? 'N/A'}, Proactivity: ${summary.ckpiMetrics?.averages?.proactivity ?? 'N/A'}, Impact: ${summary.ckpiMetrics?.averages?.impact ?? 'N/A'}
- CKPI Trend: ${summary.ckpiMetrics?.trend != null ? (summary.ckpiMetrics.trend > 0 ? '+' : '') + summary.ckpiMetrics.trend + '%' : 'N/A'}`;

  const scoredExamples = summary.assignments?.filter(a => a.score != null).slice(0, 3).map(a => `${a.user}: ${a.score} (${a.test})`).join('\n') || 'N/A';
  const topScored = summary.topUsersByScore?.slice(0, 3).map(a => `${a.user}: ${a.score}`).join(', ') || 'N/A';

  return `Current data snapshot:
${context}
${isAdmin ? '' : `\nSample scored assignments:\n${scoredExamples}\nTop users: ${topScored}`}

Available actions with their rules:

1. "list_assignments": Return matching assignments sorted/grouped. Rules:
   - For "top", "best", "highest", "leading" → sort: { field: "score", direction: "desc" }, limit: 10
   - For "bottom", "worst", "lowest" → sort: { field: "score", direction: "asc" }, limit: 10
   - For "all", "list", "show all", "every" → no limit
   - For "by role", "group by role" → groupBy: "role"
   - For "by test", "per test" → groupBy: "test"
   - For "pending", "incomplete", "not completed", "missing" → statuses: ["ASSIGNED", "IN_PROGRESS"]
   - "recent", "latest", "last month" → dateFrom/dateTo relative

2. "aggregate": Compute stats (avg, distribution). Used for "average", "what is the", "how many", "distribution".
   - groupBy null → single average
   - groupBy "role" → per-role averages
   - groupBy "test" → per-test averages

3. "count": Count entities. Used for "how many" when not asking for average. Returns single number.

4. "trend": Show CKPI evolution over months. Used for "trend", "evolution", "over time", "progress", "improvement", "getting better".

5. "out_of_scope": The question is not about company performance, users, tests, assignments, CKPI scores, problems, or solutions.

6. "problem_query": Answer questions about problems, issues, challenges, struggles, what's wrong. Query types:
   - "top"/"most"/"biggest"/"main" → queryType: "top", returns most frequent problem cluster with individual report summaries
   - named (e.g. "tell me about internal comm") → queryType: "named", searchTerm: the topic name
   - "list"/"all"/"show" → queryType: "list", returns all problem clusters sorted by frequency
   - otherwise → queryType: "overview", returns summary counts
   Uses summary.problemSolutionOverview.problemCategories and .problems.

7. "solution_query": Answer questions about solutions, fixes, improvements, what can we do. Query types:
   - "top"/"best"/"most feasible" → queryType: "top", returns top solution with feasibility/impact and individual report summaries
   - named (e.g. "tell me about peer mentoring") → queryType: "named", searchTerm: topic name
   - "list"/"all"/"show" → queryType: "list", returns all solution clusters sorted by score
   - otherwise → queryType: "overview", returns summary counts
   Uses summary.problemSolutionOverview.solutionCategories and .solutions.

8. "component_query": Answer questions about CKPI skill components. Used for "critical thinking", "creativity", "originality", "feasibility", "proactivity", "impact", "simplification", "component breakdown", "skills", "scores by category".
   - Returns all 6 component averages with trend direction.
   - If a specific component is mentioned, highlights that one.
   - Uses summary.ckpiMetrics.averages and summary.ckpiMetrics.componentTrends.

CRITICAL: Choose "out_of_scope" ONLY if the question truly has nothing to do with the data. For vague or ambiguous questions, try your best to match one of the other actions.

{
  "action": "list_assignments" | "aggregate" | "count" | "trend" | "out_of_scope" | "problem_query" | "solution_query" | "component_query",
  "filters": {
    "statuses": string[] | null,
    "roles": string[] | null,
    "testTitles": string[] | null,
    "userNames": string[] | null,
    "minScore": number | null,
    "maxScore": number | null,
    "dateFrom": "YYYY-MM-DD" | null,
    "dateTo": "YYYY-MM-DD" | null
  },
  "sort": { "field": "score" | "name" | "date" | null, "direction": "asc" | "desc" | null } | null,
  "groupBy": "user" | "test" | "role" | "month" | null,
  "limit": number | null,
  "reasoning": "Brief explanation (under 20 words)",
  "message": "Friendly guidance for out_of_scope questions" | null,
  "queryType": "top" | "list" | "named" | "overview" | null,
  "searchTerm": "string | null"
}

Question: "${question}"`;
}

function applyFilters(assignments, filters) {
  let filtered = [...assignments];
  if (filters.statuses && filters.statuses.length) {
    filtered = filtered.filter(a => filters.statuses.includes(a.status));
  }
  if (filters.roles && filters.roles.length) {
    filtered = filtered.filter(a => filters.roles.includes(a.role));
  }
  if (filters.testTitles && filters.testTitles.length) {
    const lower = filters.testTitles.map(t => t.toLowerCase());
    filtered = filtered.filter(a => lower.some(t => a.test?.toLowerCase().includes(t)));
  }
  if (filters.userNames && filters.userNames.length) {
    const lower = filters.userNames.map(n => n.toLowerCase());
    filtered = filtered.filter(a => lower.some(n => a.user?.toLowerCase().includes(n)));
  }
  if (filters.minScore != null) {
    filtered = filtered.filter(a => a.score != null && a.score >= filters.minScore);
  }
  if (filters.maxScore != null) {
    filtered = filtered.filter(a => a.score != null && a.score <= filters.maxScore);
  }
  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom);
    filtered = filtered.filter(a => a.completedAt && new Date(a.completedAt) >= from);
  }
  if (filters.dateTo) {
    const to = new Date(filters.dateTo);
    filtered = filtered.filter(a => a.completedAt && new Date(a.completedAt) <= to);
  }
  return filtered;
}

function applySort(filtered, sort) {
  if (!sort || !sort.field) return filtered;
  const dir = sort.direction === 'asc' ? 1 : -1;
  return [...filtered].sort((a, b) => {
    let va, vb;
    switch (sort.field) {
      case 'score': va = a.score ?? -1; vb = b.score ?? -1; break;
      case 'name': va = (a.user || '').toLowerCase(); vb = (b.user || '').toLowerCase(); break;
      case 'date': va = a.completedAt ? new Date(a.completedAt).getTime() : 0; vb = b.completedAt ? new Date(b.completedAt).getTime() : 0; break;
      default: return 0;
    }
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
}

function formatAssignments(filtered, plan) {
  if (!filtered.length) return 'No matching data found.';

  const groupBy = plan.groupBy;
  if (groupBy === 'user') {
    const grouped = {};
    filtered.forEach(a => {
      if (!grouped[a.user]) grouped[a.user] = [];
      grouped[a.user].push(a);
    });
    const lines = Object.entries(grouped).map(([user, items]) => {
      const scores = items.filter(i => i.score != null).map(i => i.score);
      const avg = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : 'N/A';
      return `**${user}** — avg CKPI **${avg}** (${items.length} assignments)`;
    });
    return ['Results by user:', ...lines].join('\n');
  }

  if (groupBy === 'test') {
    const grouped = {};
    filtered.forEach(a => {
      const t = a.test || 'Unknown';
      if (!grouped[t]) grouped[t] = [];
      grouped[t].push(a);
    });
    const lines = Object.entries(grouped).map(([test, items]) => {
      const scores = items.filter(i => i.score != null).map(i => i.score);
      const avg = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : 'N/A';
      return `**${test}** — avg CKPI **${avg}** (${items.length} assignments)`;
    });
    return ['Results by test:', ...lines].join('\n');
  }

  if (groupBy === 'role') {
    const grouped = {};
    filtered.forEach(a => {
      const r = a.role || 'Unknown';
      if (!grouped[r]) grouped[r] = [];
      grouped[r].push(a);
    });
    const lines = Object.entries(grouped).map(([role, items]) => {
      const scores = items.filter(i => i.score != null).map(i => i.score);
      const avg = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : 'N/A';
      return `**${role}** — avg CKPI **${avg}** (${items.length} assignments)`;
    });
    return ['Results by role:', ...lines].join('\n');
  }

  return ['Results:', ...filtered.map((a, idx) => {
    const score = a.score != null ? `CKPI **${a.score}**` : 'Not scored';
    return `${idx + 1}. **${a.user}** — ${score} (${a.test})${a.status !== 'COMPLETED' ? ` — *${a.status}*` : ''}`;
  })].join('\n');
}

function executeAgainstSummary(plan, summary) {
  const assignments = summary.assignments || [];

  if (plan.action === 'list_assignments') {
    let filtered = applyFilters(assignments, plan.filters);
    filtered = applySort(filtered, plan.sort);
    if (plan.limit && filtered.length > plan.limit) filtered = filtered.slice(0, plan.limit);
    return formatAssignments(filtered, plan);
  }

  if (plan.action === 'aggregate') {
    let filtered = applyFilters(assignments, plan.filters);
    const scored = filtered.filter(a => a.score != null);
    if (!scored.length) return 'No scored assignments match your criteria.';
    const avg = Math.round(scored.reduce((s, v) => s + v.score, 0) / scored.length);

    if (plan.groupBy === 'role') {
      const byRole = {};
      scored.forEach(a => {
        const r = a.role || 'Unknown';
        if (!byRole[r]) byRole[r] = [];
        byRole[r].push(a.score);
      });
      const lines = Object.entries(byRole).map(([role, scores]) =>
        `- **${role}**: avg CKPI **${Math.round(scores.reduce((s, v) => s + v, 0) / scores.length)}** (${scores.length} assignments)`
      );
      return [`Average CKPI by role:`, ...lines].join('\n');
    }

    if (plan.groupBy === 'test') {
      const byTest = {};
      scored.forEach(a => {
        const t = a.test || 'Unknown';
        if (!byTest[t]) byTest[t] = [];
        byTest[t].push(a.score);
      });
      const lines = Object.entries(byTest).map(([test, scores]) =>
        `- **${test}**: avg CKPI **${Math.round(scores.reduce((s, v) => s + v, 0) / scores.length)}** (${scores.length} assignments)`
      );
      return [`Average CKPI by test:`, ...lines].join('\n');
    }

    return `Average CKPI: **${avg}** (from ${scored.length} scored assignments)`;
  }

  if (plan.action === 'count') {
    let filtered = applyFilters(assignments, plan.filters);
    return `Count: **${filtered.length}**`;
  }

  if (plan.action === 'trend') {
    const evolution = summary.ckpiEvolution || [];
    if (!evolution.length) return 'No historical data available for trend analysis.';
    return ['CKPI trend over time:', ...evolution.map(e => `- **${e.month}**: **${e.avgScore}**`)].join('\n');
  }

  // Problem query: uses summary.problemSolutionOverview
  if (plan.action === 'problem_query') {
    const ps = summary.problemSolutionOverview || {};
    const categories = ps.problemCategories || [];
    const problems = ps.problems || [];

    if (plan.queryType === 'top') {
      const top = problems[0];
      if (!top) return 'No problem clusters identified for your company.';
      const cat = categories.find(c => c.key === top.key || c.cluster === top.cluster);
      const lines = [
        `**Most found problem**: ${top.cluster || top.key}`,
        `**Reports**: ${top.count} | **Avg CKPI**: ${top.avgFinal}`,
      ];
      if (cat?.reports?.length) {
        lines.push('', '**Individual report details**:');
        cat.reports.slice(0, 5).forEach((r, idx) => {
          lines.push(`${idx + 1}. *${new Date(r.date).toLocaleDateString()}* — ${r.summary}`);
        });
      }
      return lines.join('\n');
    }

    if (plan.queryType === 'named' && plan.searchTerm) {
      const term = plan.searchTerm.toLowerCase();
      const match = categories.find(c =>
        (c.cluster && c.cluster.toLowerCase().includes(term)) ||
        (c.key && c.key.toLowerCase().includes(term))
      );
      if (match) {
        const lines = [
          `**${match.cluster || match.key}**`,
          `**Reports**: ${match.count} | **Avg CKPI**: ${match.avgFinal}`,
        ];
        if (match.reports?.length) {
          lines.push('', '**Individual reports**:');
          match.reports.slice(0, 10).forEach((r, idx) => {
            lines.push(`${idx + 1}. *${new Date(r.date).toLocaleDateString()}* — ${r.summary}`);
          });
        }
        return lines.join('\n');
      }
      return `No problem found matching "${plan.searchTerm}".`;
    }

    if (plan.queryType === 'list') {
      if (!problems.length) return 'No problem clusters identified for your company.';
      return ['Problem clusters:', ...problems.slice(0, 10).map((p, idx) => `${idx + 1}. **${p.cluster || p.key || 'Unknown'}** — ${p.count} reports (avg CKPI ${p.avgFinal})`)].join('\n');
    }

    // overview
    if (problems.length) {
      return [
        `Your company has **${problems.length}** problem clusters (${ps.totalProblemCount || 0} total reports).`,
        `**Most frequent**: ${problems[0]?.cluster || problems[0]?.key} (${problems[0]?.count} reports)`
      ].join('\n');
    }
    return 'No problem clusters identified yet for your company.';
  }

  // Solution query: uses summary.problemSolutionOverview
  if (plan.action === 'solution_query') {
    const ps = summary.problemSolutionOverview || {};
    const categories = ps.solutionCategories || [];
    const solutions = ps.solutions || [];

    if (plan.queryType === 'top') {
      const top = solutions[0];
      if (!top) return 'No solution clusters identified for your company.';
      const cat = categories.find(c => c.key === top.key || c.cluster === top.cluster);
      const lines = [
        `**Top solution**: ${top.cluster || top.key}`,
        `**Reports**: ${top.count} | **Feasibility**: ${top.avgFeasibility ?? 'N/A'} | **Impact**: ${top.avgImpact ?? 'N/A'}`,
      ];
      if (cat?.reports?.length) {
        lines.push('', '**Individual report details**:');
        cat.reports.slice(0, 5).forEach((r, idx) => {
          lines.push(`${idx + 1}. *${new Date(r.date).toLocaleDateString()}* — ${r.summary}`);
        });
      }
      return lines.join('\n');
    }

    if (plan.queryType === 'named' && plan.searchTerm) {
      const term = plan.searchTerm.toLowerCase();
      const match = categories.find(c =>
        (c.cluster && c.cluster.toLowerCase().includes(term)) ||
        (c.key && c.key.toLowerCase().includes(term))
      );
      if (match) {
        const lines = [
          `**${match.cluster || match.key}**`,
          `**Reports**: ${match.count} | **Feasibility**: ${match.avgFeasibility ?? 'N/A'} | **Impact**: ${match.avgImpact ?? 'N/A'}`,
        ];
        if (match.reports?.length) {
          lines.push('', '**Individual reports**:');
          match.reports.slice(0, 10).forEach((r, idx) => {
            lines.push(`${idx + 1}. *${new Date(r.date).toLocaleDateString()}* — ${r.summary}`);
          });
        }
        return lines.join('\n');
      }
      return `No solution found matching "${plan.searchTerm}".`;
    }

    if (plan.queryType === 'list') {
      if (!solutions.length) return 'No solution clusters identified for your company.';
      return ['Solution clusters:', ...solutions.slice(0, 10).map((s, idx) => `${idx + 1}. **${s.cluster || s.key || 'Unknown'}** — ${s.count} reports (feasibility ${s.avgFeasibility ?? 0})`)].join('\n');
    }

    // overview
    if (solutions.length) {
      return [
        `Your company has **${solutions.length}** solution clusters (${ps.totalSolutionCount || 0} total reports).`,
        `**Best**: ${solutions[0]?.cluster || solutions[0]?.key} (feasibility ${solutions[0]?.avgFeasibility || 'N/A'})`
      ].join('\n');
    }
    return 'No solution clusters identified yet for your company.';
  }

  // Component query: uses summary.ckpiMetrics
  if (plan.action === 'component_query') {
    const ckpi = summary.ckpiMetrics;
    if (!ckpi || !ckpi.averages) return 'Component-level CKPI data is not available yet.';

    const lines = [
      'CKPI component averages:',
      `- Critical Thinking: **${ckpi.averages.criticalThinking || 0}**`,
      `- Creativity/Originality: **${ckpi.averages.originality || 0}**`,
      `- Feasibility: **${ckpi.averages.feasibility || 0}**`,
      `- Proactivity: **${ckpi.averages.proactivity || 0}**`,
      `- Impact: **${ckpi.averages.impact || 0}**`,
      `- Simplification: **${ckpi.averages.simplification || 0}**`,
      '',
      `Global CKPI: **${ckpi.globalCkpi || 0}**`,
      `Trend vs last month: **${ckpi.trend > 0 ? '+' : ''}${ckpi.trend || 0}%**`,
      `Based on ${ckpi.totalReports || 0} completed reports.`,
    ];

    // If a specific component is mentioned, highlight it in the reasoning
    return lines.join('\n');
  }

  return null;
}

async function parseQuestion(question, summary, isAdmin) {
  const prompt = buildParsePrompt(question, summary, isAdmin);
  try {
    const result = await gptJson([
      { role: 'system', content: PARSE_SYSTEM },
      { role: 'user', content: prompt }
    ], 600);
    if (!result || !result.action) return null;
    if (!['list_assignments', 'aggregate', 'count', 'trend', 'out_of_scope', 'problem_query', 'solution_query', 'component_query'].includes(result.action)) return null;
    return result;
  } catch (err) {
    console.warn('[SemanticQuery] Parse failed:', err.message);
    return null;
  }
}

async function semanticAnswer(question, summary, isAdmin = false) {
  const plan = await parseQuestion(question, summary, isAdmin);
  if (!plan) return null;

  if (plan.action === 'out_of_scope') {
    const msg = plan.message || 'I can only answer questions about your company data, user performance, tests, CKPI scores, and related metrics. Please ask something within those areas.';
    return {
      answer: msg,
      source: 'semantic_out_of_scope',
      metadata: { intent: 'out_of_scope', reasoning: plan.reasoning }
    };
  }

  const answer = executeAgainstSummary(plan, summary);
  if (!answer) return null;

    return {
      answer,
      source: 'semantic',
      metadata: {
        intent: plan.action,
        reasoning: plan.reasoning,
        filtersApplied: plan.filters,
        sort: plan.sort,
        groupBy: plan.groupBy,
        limit: plan.limit,
        queryType: plan.queryType || null,
        searchTerm: plan.searchTerm || null
      }
    };
}

module.exports = { semanticAnswer };
