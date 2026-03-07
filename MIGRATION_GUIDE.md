# Migration Guide: Simplified Dynamic Assessment System

## Overview
This guide helps you migrate from the rigid 6-phase system to the new simplified, GPT-guided dynamic conversation system.

## ⚠️ IMPORTANT: Database Migration Required

### Step 1: Backup Your Database
```bash
# Export your current database
mysqldump -u your_username -p your_database_name > backup_before_migration.sql
```

### Step 2: Run Prisma Migration
```bash
cd "E:\RPLT main"

# Generate Prisma client with new schema
npx prisma generate

# Create and apply migration
npx prisma migrate dev --name simplified_dynamic_tests

# OR if you want to reset (⚠️ THIS WILL DELETE ALL DATA)
npx prisma migrate reset
npx prisma migrate dev
```

## What Changed?

### Database Changes (schema.prisma):

#### Test Model:
- **REMOVED**: `phases` JSON field (complex 6-phase structure)
- **REMOVED**: `Prompt` model (separate prompts table)
- **ADDED**: `systemPrompt` Text field (single comprehensive prompt)

#### TestAttempt Model:
- **REMOVED**: `currentPhase` Int field
- **ADDED**: `messageCount` Int field
- **ADDED**: `isCompleted` Boolean field

#### TestAnswer Model:
- **REMOVED**: `stepIndex`, `phase`, `question`, `optionKey`, `openText`
- **ADDED**: `messageIndex` Int (order in conversation)
- **ADDED**: `userMessage` Text (full user message)
- **ADDED**: `gptResponse` Text (GPT's response)

### Backend Changes:

#### New Services:
1. **conversationServiceSimplified.js**: Dynamic conversation handling
   - No fixed phases
   - GPT guides entire conversation
   - Natural flow based on user responses

2. **testServiceSimplified.js**: Simple test CRUD
   - Single systemPrompt field
   - Easy test creation
   - No complex prompt management

#### Updated Controllers:
- **conversationControllerSimplified.js**: New endpoints
  - `POST /api/conversation/start` - Start test
  - `POST /api/conversation/message` - Send message
  - `POST /api/conversation/complete` - Complete test

- **testController.js**: Now uses simplified service

### Frontend Changes:

#### New Pages:
1. **TestsSimplified.jsx**: Easy test creation
   - Single form with title, description, systemPrompt
   - Default template provided
   - No complex phase configuration

2. **TestFlowDynamic.jsx**: Dynamic test taking
   - Natural conversation interface
   - React Markdown rendering (lists, bold, tables, etc.)
   - GPT guides the flow
   - Auto-save progress

#### Features:
- ✅ React Markdown support for rich GPT responses
- ✅ Real-time conversation
- ✅ Auto-save progress
- ✅ Resume capability
- ✅ Clean, modern UI
- ✅ Fully responsive

## Testing the Changes

### 1. Start Backend
```bash
cd "E:\RPLT main"
npm start
# OR
nodemon index.js
```

### 2. Start Frontend
```bash
cd "E:\Rplt FE\rplt-fe"
npm install  # Install react-markdown if needed
npm run dev
```

### 3. Test Admin Flow
1. Login as SUPER_ADMIN
2. Go to `/dashboard/tests`
3. Click "New Test"
4. Fill in:
   - Title: "Change Management Assessment"
   - Description: "Evaluate change readiness"
   - System Prompt: (use provided template or custom)
   - Status: DRAFT or ACTIVE
5. Click "Save Test"
6. Assign to company
7. Users in that company will see it

### 4. Test User Flow
1. Login as USER
2. Go to `/test`
3. Select assessment
4. Have natural conversation with GPT
5. GPT will guide the entire flow
6. When GPT says "assessment complete", click "Complete & View Report"

## Default System Prompt Template

The system includes a comprehensive default template:
- Guides GPT to conduct natural conversation
- Evaluates: Problem-solving, Creative thinking, Feasibility, Proactivity
- Supports markdown formatting
- Clear completion signal

## Key Benefits

### For Admins:
✅ **Much Simpler**: One prompt instead of 12+ prompts
✅ **Faster Setup**: Create test in 2 minutes
✅ **More Flexible**: Easy to customize
✅ **Less Maintenance**: Single prompt to update

### For Users:
✅ **Natural Flow**: Like talking to a person
✅ **Rich Formatting**: Lists, bold, tables via markdown
✅ **Adaptive**: GPT adjusts to responses
✅ **Better UX**: Smooth conversation

### System:
✅ **Scalable**: Simpler data model
✅ **Maintainable**: Less code complexity
✅ **Extensible**: Easy to add features
✅ **Cost-Effective**: Fewer API calls

## Troubleshooting

### Migration Fails
```bash
# Check database connection
npx prisma db pull

# If needed, reset and start fresh (⚠️ DELETES DATA)
npx prisma migrate reset
```

### Frontend Build Errors
```bash
cd "E:\Rplt FE\rplt-fe"
npm install react-markdown remark-gfm rehype-raw
npm run dev
```

### Backend Errors
- Check `.env` has `OPENAI_API_KEY`
- Verify `DATABASE_URL` is correct
- Restart server after schema changes

## Rollback (If Needed)

If you need to rollback:
1. Restore database from backup
2. Git revert the changes
3. Run old Prisma schema
4. Restart servers

## Support

For issues:
1. Check console logs (browser & server)
2. Verify database migration succeeded
3. Ensure all dependencies installed
4. Check API keys configured

## Next Steps

After migration:
1. Create sample tests
2. Test with users
3. Monitor GPT responses
4. Adjust system prompts as needed
5. Collect feedback

---

**Migration Complete!** 🎉

Your system is now simplified and ready for dynamic, GPT-guided assessments!
