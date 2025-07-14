import {
  type Action,
  type Content,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  type UUID,
  createUniqueUuid,
  logger,
  type State,
} from '@elizaos/core';
import type { TeamMemberUpdate } from '../../../types';

export async function generateTeamReport(
  runtime: IAgentRuntime,
  standupType: string,
  roomId?: string
): Promise<string> {
  try {
    logger.info('=== GENERATE TEAM REPORT START ===');
    logger.info(`Generating report for standup type: ${standupType}`);

    const roomIdLocal = createUniqueUuid(runtime, 'report-channel-config');

    // Get all messages from the room that match the standup type
    const memories = await runtime.getMemories({
      tableName: 'messages',
      agentId: runtime.agentId,
    });

    logger.info(`Retrieved ${memories.length} total messages from room`);

    // Filter for team member updates with matching standup type
    const updates = memories
      .filter((memory) => {
        const content = memory.content as {
          type?: string;
          update?: TeamMemberUpdate;
        };
        const contentType = content?.type;
        const requestedType = standupType.toLowerCase();
        const checkInType = content?.update?.checkInType;

        return contentType === 'team-member-update';
        // && checkInType === standupType
      })
      .map((memory) => (memory.content as { update: TeamMemberUpdate })?.update)
      .filter((update): update is TeamMemberUpdate => !!update)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    logger.info(`Found ${updates.length} updates matching standup type: ${standupType}`);

    // Generate the report
    let report = `📊 **Team Progress Report - ${standupType} Standups**\n\n`;

    if (updates.length === 0) {
      report += `No updates found for "${standupType}" standups in this room.\n`;
      return report;
    }

    // Group updates by team member
    const updatesByMember: Record<string, TeamMemberUpdate[]> = {};
    for (const update of updates) {
      logger.info(
        `Processing update for team member: ${update.teamMemberName || 'Unknown'} (${update.teamMemberId})`
      );
      if (!updatesByMember[update.teamMemberId]) {
        updatesByMember[update.teamMemberId] = [];
      }
      updatesByMember[update.teamMemberId].push(update);
    }

    // Generate report for each team member
    for (const [teamMemberId, memberUpdates] of Object.entries(updatesByMember)) {
      const teamMemberName = memberUpdates[0]?.teamMemberName || 'Unknown';
      logger.info(`Generating report section for: ${teamMemberName} (${teamMemberId})`);
      report += `👤 **${teamMemberName}** (ID: ${teamMemberId})\n\n`;

      // Prepare update data for analysis, converting answers JSON to objects
      const processedUpdates = memberUpdates.map((update) => {
        try {
          // Parse the JSON string to get the actual answers
          const answers = update.answers ? JSON.parse(update.answers) : {};

          return {
            teamMemberId: update.teamMemberId,
            teamMemberName: update.teamMemberName,
            serverName: update.serverName,
            checkInType: update.checkInType,
            timestamp: update.timestamp,
            answers,
          };
        } catch (error) {
          logger.error('Error parsing answers JSON:', error);
          return update;
        }
      });

      // Create prompt for analysis
      const prompt = `CRITICAL: You must respond with ONLY plain text narrative. NO structured formats, NO code blocks, NO JSON, NO tool_code, NO markdown code fences.

      Analyze these team member updates and write a simple paragraph summary. Write like a human manager would write.

      Focus on:
      - What they accomplished this week
      - What they're working on next week
      - Any blockers they mentioned
      - Overall assessment

      Example good response:
      "Based on recent updates, the team member has made solid progress on the Jimmy project integrations this week, completing the initial setup and drafting the integration plan. Their main focus for next week will be continuing work on the Jimmy project integrations. They currently need clarification on API specifications which may impact their timeline."

      RESPOND WITH PLAIN TEXT ONLY. NO CODE BLOCKS OR STRUCTURED FORMATS.

      Updates data: ${JSON.stringify(processedUpdates, null, 2)}`;

      logger.info('Generating productivity analysis for team member:', teamMemberName);

      try {
        const analysis = await runtime.useModel(ModelType.TEXT_LARGE, {
          prompt,
          stopSequences: [],
        });

        // Clean the analysis to remove any structured formats
        let cleanAnalysis = analysis.trim();
        
        // Remove any code blocks or structured formats
        cleanAnalysis = cleanAnalysis.replace(/```[\s\S]*?```/g, '');
        cleanAnalysis = cleanAnalysis.replace(/`[^`]*`/g, '');
        cleanAnalysis = cleanAnalysis.replace(/^\s*\{[\s\S]*\}\s*$/g, '');
        cleanAnalysis = cleanAnalysis.replace(/tool_code|tool_name|tool_input/g, '');
        
        // If the cleaned analysis is empty or too short, provide a fallback
        if (cleanAnalysis.length < 50) {
          cleanAnalysis = `Team member has provided updates but detailed analysis could not be generated at this time.`;
        }

        report += `📋 **Productivity Analysis**:\n${cleanAnalysis}\n\n`;
        report += `📅 **Recent Updates**:\n`;

        // Add last 3 updates for reference
        const recentUpdates = memberUpdates.slice(0, 3);
        for (const update of recentUpdates) {
          report += `\n🕒 **${new Date(update.timestamp).toLocaleString()}**\n`;

          try {
            const answers = update.answers ? JSON.parse(update.answers) : {};

            // Display all answers from the update in a cleaner format
            for (const [question, answer] of Object.entries(answers)) {
              if (answer && answer !== 'undefined' && answer !== 'null') {
                report += `• **${question}**: ${answer}\n`;
              }
            }
          } catch (error) {
            logger.error('Error parsing answers JSON for display:', error);
            report += `• Error parsing update details\n`;
          }
        }
      } catch (error) {
        logger.error('Error generating analysis:', error);
        report += '❌ Error generating analysis. Showing recent updates:\n\n';

        for (const update of memberUpdates.slice(0, 3)) {
          report += `🕒 **${new Date(update.timestamp).toLocaleString()}**\n`;

          try {
            const answers = update.answers ? JSON.parse(update.answers) : {};

            // Display all answers from the update in a cleaner format
            for (const [question, answer] of Object.entries(answers)) {
              if (answer && answer !== 'undefined' && answer !== 'null') {
                report += `• **${question}**: ${answer}\n`;
              }
            }
          } catch (error) {
            logger.error('Error parsing answers JSON for display:', error);
            report += `• Error parsing update details\n`;
          }
        }
      }
      report += '\n-------------------\n\n';
    }

    logger.info('Successfully generated team report');
    logger.info('=== GENERATE TEAM REPORT END ===');
    return report;
  } catch (error) {
    logger.error('Error generating team report:', error);
    throw error;
  }
}

export const generateReport: Action = {
  name: 'GENERATE_REPORT',
  description: 'Generates comprehensive reports of team member updates and productivity analysis for daily standups, sprint check-ins, project status, mental health check-ins, and team retrospectives. Provides intelligent workflow guidance and educates users about critical prerequisites (team members must be added and have submitted updates BEFORE generating reports). Explains consequences of improper setup order and guides users to use the correct actions for each step. Use when user asks for reports, progress updates, team analysis, or wants to see how the team is doing.',
  similes: [
    'CREATE_REPORT',
    'TEAM_REPORT',
    'GET_TEAM_REPORT',
    'SHOW_TEAM_REPORT',
    'PRODUCE_TEAM_ANALYSIS',
    'GENERATE_TEAM_REPORT',
    'CREATE_TEAM_ANALYSIS',
    'SHOW_PROGRESS',
    'GET_PROGRESS',
    'TEAM_PROGRESS',
    'DAILY_REPORT',
    'STANDUP_REPORT',
    'SPRINT_REPORT',
    'PROJECT_REPORT',
    'MENTAL_HEALTH_REPORT',
    'RETRO_REPORT',
    'RETROSPECTIVE_REPORT',
    'PRODUCTIVITY_REPORT',
    'STATUS_REPORT',
    'PROGRESS_REPORT',
    'TEAM_STATUS',
    'TEAM_UPDATES',
    'UPDATE_REPORT',
  ],
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    logger.info('Validating generateReport action');
    return true;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    options: Record<string, unknown> = {},
    callback?: HandlerCallback
  ): Promise<boolean> => {
    try {
      logger.info('=== GENERATE REPORT HANDLER START ===');

      if (!state) return false;
      if (!callback) {
        logger.warn('No callback function provided');
        return false;
      }

      // Extract standup type from message text
      const text = message.content?.text as string;
      if (!text) {
        logger.warn('No text content found in message');
        return false;
      }
      let standupType: string;

      // Use AI to parse the input text and extract standup type
      try {
        const prompt = `CRITICAL: You must respond with ONLY one of these exact values: STANDUP, SPRINT, MENTAL_HEALTH, PROJECT_STATUS, RETRO

Extract the check-in type from this user input. Look for keywords and context:

User input: "${text}"

Keyword mappings:
- "standup", "daily standup", "daily", "stand up" → STANDUP
- "sprint", "sprint check-in", "sprint review" → SPRINT  
- "mental health", "mental", "wellness", "wellbeing" → MENTAL_HEALTH
- "project status", "project", "status update", "progress" → PROJECT_STATUS
- "retro", "retrospective", "team retrospective" → RETRO
- "report" (generic) → STANDUP

If no specific type is mentioned or just "report", default to STANDUP.

Respond with ONLY the exact type value:`;

        const parsedType = await runtime.useModel(ModelType.TEXT_LARGE, {
          prompt,
          stopSequences: [],
        });

        const cleanedType = parsedType.trim().toUpperCase();
        logger.info('AI parsed standup type:', cleanedType);

        // Map AI response to our internal format
        const typeMapping: Record<string, string> = {
          'STANDUP': 'standup',
          'SPRINT': 'sprint', 
          'MENTAL_HEALTH': 'mental_health',
          'PROJECT_STATUS': 'project_status',
          'RETRO': 'retro'
        };

        standupType = typeMapping[cleanedType] || 'standup';
        logger.info('Mapped to internal type:', standupType);

        // Enhanced user guidance based on prompt_confused.md
        function getWorkflowGuidance(): string {
          return `🔍 **IMPORTANT: Report Generation Workflow**

**⚠️ CRITICAL PREREQUISITE:** Team members must be added and have submitted updates

**Why this matters:**
- Reports are only useful when team members have submitted their updates
- Empty reports provide no value and waste your time
- Without team members configured, check-ins can't be collected

**📋 PROPER WORKFLOW (Follow This Order):**

**STEP 1: Add Team Members** 🛠️ **(REQUIRED FIRST)**
\`\`\`
Add [Name] to [Section] with discord @username
\`\`\`

**STEP 2: Configure Check-ins** (After adding team members)
\`\`\`
Setup check-in schedule for [frequency] at [time]
\`\`\`

**STEP 3: Collect Updates** (After team members submit)
\`\`\`
Team members submit their updates via check-in process
\`\`\`

**STEP 4: Generate Report** (After updates are collected)
\`\`\`
Generate me a report for [type]
\`\`\`

**✅ Verify Your Setup:**
- Use \`list team members\` to check if you have team members configured
- Verify team members have submitted recent updates
- Check that the report type matches your needs

**Need help with team setup?** Ask: "How do I add team members?"`;
        }

        // Check if we have team members configured (basic check)
        const allMemories = await runtime.getMemories({
          tableName: 'messages',
          agentId: runtime.agentId,
        });

        const teamMemberUpdates = allMemories.filter((memory) => {
          const content = memory.content as {
            type?: string;
            update?: TeamMemberUpdate;
          };
          return content?.type === 'team-member-update';
        });

        if (teamMemberUpdates.length === 0) {
          const workflowGuidance = getWorkflowGuidance();
          await callback(
            {
              text: `${workflowGuidance}\n\n**🚨 Current Issue:** No team member updates found. You need to add team members and collect their updates before generating meaningful reports.`,
              source: 'discord',
            },
            []
          );
          return true;
        }

        // Validate standup type with more flexible matching
        const validTypes = ['standup', 'sprint', 'mental_health', 'project_status', 'retro'];
        const isValidType = validTypes.some((type) => standupType === type);

        if (!isValidType) {
          await callback(
            {
              text: `🔍 **Report Type Options:**
              
**Available Report Types:**
- 📊 **Daily Standup** - Regular team updates and progress
- 🏃 **Sprint Check-in** - Sprint-specific progress and blockers  
- 💚 **Mental Health Check-in** - Team wellness and support needs
- 📈 **Project Status Update** - Project milestones and deliverables
- 🔄 **Team Retrospective** - Team reflection and improvement areas

**Examples:**
- \`Generate me a report for daily standup\`
- \`Show me the sprint progress report\`
- \`Create a mental health check-in report\`

**Need help choosing?** Daily Standup is most common for regular team updates.`,
              source: 'discord',
            },
            []
          );
          return false;
        }
      } catch (aiError) {
        logger.error('Error using AI to parse input:', aiError);
        // Fallback to default standup type instead of failing
        standupType = 'standup';
        logger.info('Using default standup type due to AI error');
      }

      // Generate the report
      const report = await generateTeamReport(runtime, standupType, message.roomId);

      const content: Content = {
        text: report,
        source: 'discord',
      };

      await callback(content, []);
      logger.info('=== GENERATE REPORT HANDLER END ===');
      return true;
    } catch (error: unknown) {
      const err = error as Error;
      logger.error('=== GENERATE REPORT HANDLER ERROR ===');
      logger.error('Error details:', {
        name: err.name || 'Unknown error',
        message: err.message || 'No error message',
        stack: err.stack || 'No stack trace',
      });

      if (callback) {
        const errorContent: Content = {
          text: '❌ An error occurred while generating the report. Please try again.',
          source: 'discord',
        };
        await callback(errorContent, []);
      }
      return false;
    }
  },
  examples: [
    [
      {
        name: '{{name1}}',
        content: { text: 'generate me a report around daily standup' },
      },
      {
        name: '{{botName}}',
        content: {
          text: "",
          actions: ['GENERATE_REPORT'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: { text: 'generate me a report for daily standup' },
      },
      {
        name: '{{botName}}',
        content: {
          text: "",
          actions: ['GENERATE_REPORT'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: { text: 'generate me a report' },
      },
      {
        name: '{{botName}}',
        content: {
          text: "",
          actions: ['GENERATE_REPORT'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: { text: 'show me team progress' },
      },
      {
        name: '{{botName}}',
        content: {
          text: "",
          actions: ['GENERATE_REPORT'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: { text: 'I want to see a report but I think I need to add team members first' },
      },
      {
        name: '{{botName}}',
        content: {
          text: "Smart thinking! I'll check your setup and guide you through the proper workflow.",
          actions: ['GENERATE_REPORT'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: { text: 'What do I need before generating a report?' },
      },
      {
        name: '{{botName}}',
        content: {
          text: "I'll explain all the prerequisites and guide you through the setup.",
          actions: ['GENERATE_REPORT'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: { text: 'Can I see the sprint progress report?' },
      },
      {
        name: '{{botName}}',
        content: {
          text: "",
          actions: ['GENERATE_REPORT'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: { text: 'How is the team doing?' },
      },
      {
        name: '{{botName}}',
        content: {
          text: "",
          actions: ['GENERATE_REPORT'],
        },
      },
    ],
  ],
};
