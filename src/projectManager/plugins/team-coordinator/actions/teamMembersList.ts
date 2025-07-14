import {
  type Action,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
  createUniqueUuid,
  type UUID,
  logger,
} from '@elizaos/core';

interface TeamMember {
  section: string;
  tgName?: string;
  discordName?: string;
  format: string;
  serverId: string;
  serverName?: string;
  createdAt?: string;
  updatesFormat?: string[];
}

/**
 * Creates a consistent room ID for team members storage
 * @param runtime The agent runtime
 * @param serverId The server ID
 * @returns A consistent room ID string
 */
function getStorageRoomId(runtime: IAgentRuntime, serverId: string): UUID {
  // Create a consistent hash based on serverId
  const serverHash = serverId.replace(/[^a-zA-Z0-9]/g, '');
  return createUniqueUuid(runtime, `store-team-members-${serverHash}`);
}

/**
 * Provides comprehensive workflow guidance for team member management
 * Following prompt_confused.md principles for user education
 */
function getTeamMemberWorkflowGuidance(): string {
  return `🔍 **IMPORTANT: Team Member Management Workflow**

**⚠️ CRITICAL PREREQUISITE:** Team members are the foundation of all project management features

**Why this matters:**
- Without team members, check-ins will have no recipients
- Reports will be empty and provide no value
- Update tracking cannot function properly
- All other features depend on having a configured team

**📋 PROPER WORKFLOW (Follow This Order):**

**STEP 1: Add Team Members** 🛠️ **(START HERE)**
\`\`\`
Add [Name] to [Section] with discord @username
\`\`\`
**Examples:**
\`\`\`
Add John to Development with discord @john123
Add Sarah to Marketing with discord @sarah456
Format: Daily goals?, Blockers?, Next priorities?
\`\`\`

**STEP 2: Configure Check-ins** (After adding team members)
\`\`\`
Setup check-in schedule for [frequency] at [time]
\`\`\`

**STEP 3: Team Members Submit Updates** (Once check-ins are configured)
\`\`\`
Team members will receive automated check-in prompts
\`\`\`

**STEP 4: Generate Reports** (After updates are collected)
\`\`\`
Generate me a report for daily standup
\`\`\`

**✅ Verify Your Setup:**
- Use \`list team members\` to see current team configuration
- Check that team members have Discord/Telegram usernames
- Verify custom update formats are configured if needed

**💡 QUICK TIPS:**
- **Right-click user in Discord** → Copy Username for exact @username
- **Tag users directly** when adding them for automatic username detection
- **Custom formats** let you tailor questions for each team member's role

**Need help adding team members?** Ask: "How do I add team members?"`;
}

/**
 * Provides next steps guidance when team members exist
 */
function getNextStepsGuidance(teamMemberCount: number): string {
  return `

**🚀 What's Next? (You have ${teamMemberCount} team member${teamMemberCount > 1 ? 's' : ''} configured)**

**Available Actions:**
- **📝 Add More Members:** \`Add [Name] to [Section] with discord @username\`
- **⏰ Setup Check-ins:** \`Setup daily check-in schedule at 9:00 AM\`
- **📊 Generate Reports:** \`Generate me a report for daily standup\`
- **🔄 View Updates:** \`Show me team updates\`

**👀 Monitor Team Activity:**
- Check-in schedules will automatically prompt team members
- Updates will be collected and stored for reporting
- Generate reports to track team productivity and blockers

**💡 Pro Tips:**
- Regular check-ins keep teams aligned and productive
- Custom update formats help gather role-specific information
- Reports provide insights into team velocity and impediments`;
}

/**
 * Provides enhanced empty state guidance with actionable next steps
 */
function getEmptyStateGuidance(): string {
  return `**🚨 Current Issue:** No team members found. This means other features won't work properly.

**⚠️ What happens without team members:**
- Check-ins will be created but no one will receive them
- Reports will be empty and provide no insights
- Update tracking cannot collect any data
- Team coordination features will be non-functional

${getTeamMemberWorkflowGuidance()}`;
}

export const listTeamMembersAction: Action = {
  name: 'LIST_TEAM_MEMBERS',
  description: 'Lists all registered team members and provides comprehensive workflow guidance. Educates users about critical team management prerequisites and explains the connection between team members and other features like check-ins, reports, and updates. When the team list is empty, guides users through the proper setup workflow with exact commands and clear next steps.',
  similes: ['LIST_TEAM_MEMBERS', 'SHOW_TEAM', 'VIEW_MEMBERS', 'GET_TEAM_LIST', 'DISPLAY_TEAM'],
  validate: async (runtime: IAgentRuntime, message: Memory, state: State | undefined): Promise<boolean> => {
    try {
      if (!state) return false;
      
      // Basic validation
      const room = state.data.room ?? (await runtime.getRoom(message.roomId));
      logger.info('Room data:', JSON.stringify(room, null, 2));

      if (!room) {
        logger.error('No room found for message');
        return false;
      }

      const serverId = room.serverId;
      if (!serverId) {
        logger.error('No server ID found for room');
        return false;
      }

      // Store server ID in state for the handler
      state.data.serverId = serverId;
      state.data.serverName = room.name || 'Unknown Server';

      logger.info(`Valid request to list team members for server ${serverId}`);
      return true;
    } catch (error: unknown) {
      const err = error as Error;
      logger.error('Error in listTeamMembersAction validation:', err);
      logger.error(`Error stack: ${err.stack || 'No stack trace available'}`);
      return false;
    }
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    options: Record<string, unknown> = {},
    callback?: HandlerCallback
  ): Promise<boolean> => {
    try {
      logger.info('=== LIST-TEAM-MEMBERS HANDLER START ===');

      if (!state) return false;
      
      if (!callback) {
        logger.warn('No callback function provided');
        return false;
      }

      // Get server ID from state
      const serverId = state.data?.serverId as string;
      const serverName = state.data?.serverName as string;

      if (!serverId) {
        logger.error('No server ID found in state');
        await callback(
          {
            text: '❌ Failed to identify the server. Please try again.',
          },
          []
        );
        return false;
      }

      logger.info(`Fetching team members for server: ${serverId} (${serverName})`);

      // FIXED: Get the correct room ID for storing team members
      const serverHash = serverId.replace(/[^a-zA-Z0-9]/g, '');
      const roomIdForStoringTeamMembers = createUniqueUuid(
        runtime,
        `store-team-members-${serverHash}`
      );

      logger.info(`Looking for team members in room: ${roomIdForStoringTeamMembers}`);

      // Get memories from the team members storage room
      const memories = await runtime.getMemories({
        roomId: roomIdForStoringTeamMembers,
        tableName: 'messages',
      });

      logger.info(`Found ${memories.length} memories in room ${roomIdForStoringTeamMembers}`);

      // Find the team members config memory
      const teamMembersConfig = memories.find(
        (memory) => memory.content?.type === 'store-team-members-memory'
      );

      if (!teamMembersConfig || !teamMembersConfig.content?.config) {
        logger.info('No team members found for this server');
        const emptyStateGuidance = getEmptyStateGuidance();
        await callback(
          {
            text: emptyStateGuidance,
          },
          []
        );
        return true;
      }

      // Extract and format team members
      const configData = teamMembersConfig.content.config as { teamMembers: TeamMember[] };
      const teamMembers = configData.teamMembers || [];
      logger.info(`Found ${teamMembers.length} team members for server ${serverId}`);

      if (teamMembers.length === 0) {
        const emptyStateGuidance = getEmptyStateGuidance();
        await callback(
          {
            text: emptyStateGuidance,
          },
          []
        );
        return true;
      }

      // Group team members by section
      const sectionMap = new Map<string, TeamMember[]>();
      teamMembers.forEach((member) => {
        const section = member.section || 'Unassigned';
        if (!sectionMap.has(section)) {
          sectionMap.set(section, []);
        }
        sectionMap.get(section)?.push(member);
      });

      // Format the response with enhanced team information
      let responseText = `📋 **Team Members Overview**

**🎯 ${teamMembers.length} Team Member${teamMembers.length > 1 ? 's' : ''} Configured**

`;

      // Group by section for better organization
      const sectionGroups = new Map<string, TeamMember[]>();
      teamMembers.forEach((member) => {
        const section = member.section || 'Unassigned';
        if (!sectionGroups.has(section)) {
          sectionGroups.set(section, []);
        }
        sectionGroups.get(section)?.push(member);
      });

      // Display by sections
      for (const [section, members] of sectionGroups) {
        responseText += `**📂 ${section} (${members.length} member${members.length > 1 ? 's' : ''})**\n`;
        
        members.forEach((member, index) => {
          let memberLine = `${index + 1}. `;
          
          if (member.discordName) {
            memberLine += `Discord: ${member.discordName}`;
          } else if (member.tgName) {
            memberLine += `Telegram: ${member.tgName}`;
          }

          if (member.updatesFormat && member.updatesFormat.length > 0) {
            memberLine += `\n   📝 Custom Update Format: ${member.updatesFormat.join(', ')}`;
          } else {
            memberLine += `\n   📝 Using default update format`;
          }

          responseText += `   ${memberLine}\n`;
        });
        responseText += '\n';
      }

      // Add workflow guidance
      const nextStepsGuidance = getNextStepsGuidance(teamMembers.length);
      responseText += nextStepsGuidance;

      // Send the enhanced response
      await callback(
        {
          text: responseText.trim(),
        },
        []
      );

      logger.info('=== LIST-TEAM-MEMBERS HANDLER END ===');
      return true;
    } catch (error: unknown) {
      const err = error as Error;
      logger.error('=== LIST-TEAM-MEMBERS HANDLER ERROR ===');
      logger.error(`Error listing team members: ${err}`);
      logger.error(`Error stack: ${err.stack || 'No stack trace available'}`);

      if (callback) {
        await callback(
          {
            text: `❌ **Unable to retrieve team members right now.**

**🔧 What you can try:**
1. **Wait a moment** and try again - this might be a temporary issue
2. **Check your setup** by asking: "How do I add team members?"
3. **Add team members first** if you haven't yet: \`Add [Name] to [Section] with discord @username\`

**💡 If this problem persists:**
- Ensure you're in the correct Discord server
- Verify your permissions for this server
- Contact support with this error information

**Need immediate help?** Ask: "How do I add team members?" to get started.`,
          },
          []
        );
      }
      return false;
    }
  },
  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Show me all team members',
        },
      },
      {
        name: '{{botName}}',
        content: {
          text: "I'll show you all team members and guide you through next steps",
          actions: ['LIST_TEAM_MEMBERS'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'list team members',
        },
      },
      {
        name: '{{botName}}',
        content: {
          text: "Here's your team overview with workflow guidance",
          actions: ['LIST_TEAM_MEMBERS'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Who is in my team?',
        },
      },
      {
        name: '{{botName}}',
        content: {
          text: "I'll show you the team members and explain what you can do next",
          actions: ['LIST_TEAM_MEMBERS'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'I want to see my team but I think I need to add people first',
        },
      },
      {
        name: '{{botName}}',
        content: {
          text: "Smart thinking! I'll check your team setup and guide you through the process",
          actions: ['LIST_TEAM_MEMBERS'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'What team members do I have and what should I do next?',
        },
      },
      {
        name: '{{botName}}',
        content: {
          text: "I'll show your team status and provide clear next steps for team management",
          actions: ['LIST_TEAM_MEMBERS'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'List all team members by section',
        },
      },
      {
        name: '{{botName}}',
        content: {
          text: "Here's your team organization with workflow guidance",
          actions: ['LIST_TEAM_MEMBERS'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'show team',
        },
      },
      {
        name: '{{botName}}',
        content: {
          text: "I'll display your team members and explain next steps",
          actions: ['LIST_TEAM_MEMBERS'],
        },
      },
    ],
  ],
};
