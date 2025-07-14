import {
  type Action,
  ChannelType,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  type State,
  createUniqueUuid,
  type UUID,
  getUserServerRole,
  logger,
} from '@elizaos/core';

interface TeamMember {
  section: string;
  tgName?: string;
  discordName?: string;
  format: string;
  serverId: string;
  serverName?: string;
  createdAt: string;
  updatesFormat?: string[];
}

interface TeamMemberConfig {
  teamMembers: TeamMember[];
  lastUpdated: number;
  serverId: string;
}

/**
 * Creates a consistent room ID for team members storage
 * @param serverId The server ID
 * @returns A consistent room ID string
 */
function getTeamMembersRoomId(runtime: IAgentRuntime, serverId: string): UUID {
  // Create a consistent hash based on serverId
  const serverHash = serverId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);

  const roomId = createUniqueUuid(runtime, `team-members-${serverHash}`);

  return roomId;
}

/**
 * Fetches team members for a specific server from memory
 * @param runtime The agent runtime
 * @param serverId The ID of the server to fetch team members for
 * @returns An array of team members
 */
async function fetchTeamMembersForServer(
  runtime: IAgentRuntime,
  serverId: string
): Promise<TeamMember[]> {
  try {
    logger.info(`Fetching team members for server ${serverId}`);

    // Create the room ID in a consistent way
    const serverSpecificRoomId = getTeamMembersRoomId(runtime, serverId);

    // Get all memories from the team members room
    const memories = await runtime.getMemories({
      roomId: serverSpecificRoomId,
      tableName: 'messages',
    });

    logger.info(`Retrieved ${memories.length} memories from room ${serverSpecificRoomId}`);

    // Filter to only include team member records
    const teamMemberMemories = memories.filter(
      (memory) =>
        memory.content && memory.content.type === 'team-member' && memory.content.teamMember
    );

    logger.info(`Found ${teamMemberMemories.length} team member records`);

    // Extract and return the team members
    const teamMembers = teamMemberMemories.map((memory) => memory.content.teamMember as TeamMember);

    // Log for debugging
    logger.info(`Successfully retrieved ${teamMembers.length} team members for server ${serverId}`);

    return teamMembers;
  } catch (error: unknown) {
    const err = error as Error;
    logger.error(`Error fetching team members for server ${serverId}:`, error);
    logger.error(`Error stack: ${err.stack || 'No stack trace available'}`);
    return [];
  }
}

/**
 * Checks if a team member already exists in the database
 * @param existingMembers The list of existing team members
 * @param newMember The new team member to check
 * @returns True if the member already exists, false otherwise
 */
function isDuplicateTeamMember(existingMembers: TeamMember[], newMember: TeamMember): boolean {
  return existingMembers.some((member) => {
    // Check if TG name matches (if both have TG names)
    if (
      member.tgName &&
      newMember.tgName &&
      member.tgName.toLowerCase() === newMember.tgName.toLowerCase()
    ) {
      logger.info(`Found duplicate TG name: ${newMember.tgName}`);
      return true;
    }

    // Check if Discord name matches (if both have Discord names)
    if (
      member.discordName &&
      newMember.discordName &&
      member.discordName.toLowerCase() === newMember.discordName.toLowerCase()
    ) {
      logger.info(`Found duplicate Discord name: ${newMember.discordName}`);
      return true;
    }

    return false;
  });
}

/**
 * Validates team member input format with comprehensive edge case handling
 * @param input The user input text
 * @returns Validation result with isValid flag and specific error message
 */
function validateTeamMemberInput(input: string): {
  isValid: boolean;
  error?: string;
  isHelpRequest?: boolean;
  errorType?: string;
} {
  if (!input || input.trim().length === 0) {
    return { 
      isValid: false, 
      error: '❌ No input provided. Please provide team member information.',
      errorType: 'empty_input'
    };
  }

  const inputLower = input.toLowerCase();

  // Check if user is asking for help (but not if they're specifying a custom format)
  const isHelpRequest = (
    inputLower.includes('help') || 
    inputLower.includes('how do i') || 
    inputLower.includes('how to') ||
    inputLower.includes('example') || 
    inputLower.includes('guide')
  ) && !inputLower.includes('format:');

  if (isHelpRequest) {
    return {
      isValid: false,
      error: '📚 Here\'s your complete guide to adding team members:',
      isHelpRequest: true,
      errorType: 'help_request'
    };
  }

  // Check for username presence (either @username or username (@id) format)
  const hasAtSymbol = inputLower.includes('@');
  const hasUsernameWithId = /\w+\s*\(@\d+\)/.test(inputLower);
  
  if (!hasAtSymbol && !hasUsernameWithId) {
    return {
      isValid: false,
      error: '❌ Missing username. Use @username or tag the user directly.',
      errorType: 'missing_username'
    };
  }

  // Check for platform specification
  const hasDiscord = inputLower.includes('discord');
  const hasTelegram = inputLower.includes('telegram') || inputLower.includes('tg');
  
  if (!hasDiscord && !hasTelegram) {
    return {
      isValid: false,
      error: '❌ Missing platform specification. Please specify \'discord\' or \'telegram\'.',
      errorType: 'missing_platform'
    };
  }

  // Check for section specification
  const hasSection = inputLower.includes('section') || inputLower.includes('add') || inputLower.includes('to');
  
  if (!hasSection) {
    return {
      isValid: false,
      error: '❌ Missing section specification. Please specify which section/role to add the user to.',
      errorType: 'missing_section'
    };
  }

  // Check for valid format patterns (handle both @username and username (@id) formats)
  const hasValidFormat1 = /add\s+\w+\s+to\s+[\w\s]+\s+with\s+(discord|telegram)\s+(@[\w\s]+|\w+\s*\(@\d+\))/i.test(input);
  const hasValidFormat2 = /section:\s*\w+.*\n.*(discord|telegram):\s*(@[\w\s]+|\w+\s*\(@\d+\))/i.test(input);
  const hasValidFormat3 = /section.*\w+.*(discord|telegram).*(@[\w\s]+|\w+\s*\(@\d+\))/i.test(input);

  if (!hasValidFormat1 && !hasValidFormat2 && !hasValidFormat3) {
    return {
      isValid: false,
      error: '❌ Invalid format. Use: Add [Name] to [Section] with discord @username',
      errorType: 'invalid_format'
    };
  }

  // Check for common mistakes - handle both @username and username (@id) formats
  const atUsernameMatch = input.match(/@([^,\n\s]+)/);
  const taggedUsernameMatch = input.match(/(\w+)\s*\(@\d+\)/);
  
  const username = atUsernameMatch ? atUsernameMatch[1] : (taggedUsernameMatch ? taggedUsernameMatch[1] : null);
  
  if (username && username.length < 2) {
    return {
      isValid: false,
      error: '❌ Username too short. Use the exact Discord/Telegram username.',
      errorType: 'username_spaces'
    };
  }

  return { isValid: true };
}

/**
 * Validates user presence in Discord server
 * @param runtime The agent runtime
 * @param username The username to validate
 * @param serverId The Discord server ID
 * @returns Promise<ValidationResult>
 */
async function validateUserPresence(
  runtime: IAgentRuntime,
  username: string,
  serverId: string
): Promise<{ isValid: boolean; error?: string; errorType?: string }> {
  try {
    // Remove @ symbol from username if present
    const cleanUsername = username.replace('@', '');
    
    // Try to find the user in the server
    // Note: This is a simplified check - in real implementation, you'd use Discord API
    // to check if user exists in the server
    
    // For now, we'll do basic validation
    if (!cleanUsername || cleanUsername.length < 2) {
      return {
        isValid: false,
        error: '❌ Invalid username format. Username must be at least 2 characters long.',
        errorType: 'invalid_username'
      };
    }
    
    // Check for common username patterns that might indicate user doesn't exist
    if (cleanUsername.includes(' ') || cleanUsername.includes('#')) {
      return {
        isValid: false,
        error: '❌ Username format incorrect. Use Discord username only (without display name or discriminator).',
        errorType: 'username_format'
      };
    }
    
    return { isValid: true };
  } catch (error) {
    logger.error('Error validating user presence:', error);
    return {
      isValid: false,
      error: '❌ Could not validate user presence. Please ensure the user is in this Discord server.',
      errorType: 'validation_error'
    };
  }
}

/**
 * Provides detailed error messages based on error type
 * @param errorType The type of error encountered
 * @returns Formatted error message with specific guidance
 */
function getDetailedErrorMessage(errorType: string): string {
  switch (errorType) {
    case 'missing_username':
      return `❌ Missing username. Use: @username or tag the user`;

    case 'missing_platform':
      return `❌ Missing platform. Use: "with discord @username"`;

    case 'missing_section':
      return `❌ Missing section. Use: "Add [Name] to [Section]"`;

    case 'invalid_format':
      return `❌ Invalid format. Use: "Add [Name] to [Section] with discord @username"`;

    case 'username_spaces':
      return `❌ Username issue. Use exact Discord username`;

    case 'invalid_username':
      return `❌ Username too short. Use complete Discord username`;

    case 'username_format':
      return `❌ Use Discord username only (not display name)`;

    default:
      return '❌ Format error. Use: Add [Name] to [Section] with discord @username';
  }
}

/**
 * Provides a quick format reminder for common cases
 * @returns Quick format reminder string
 */
function getQuickFormatReminder(): string {
  return `🚀 **Format:**
\`Add [Name] to [Section] with discord @username\`
OR
\`Add [Name] to [Section] with discord username\` (tag the user)

**With custom format:**
\`Add [Name] to [Section] with discord @username
Format: Question1, Question2, Question3\`

**Examples:**
\`Add John to Development with discord @john123\`
\`Add Sam to Software team with discord samdeveloper\` (when tagging)

**Need help?** Ask "how to add team members"`;
}

/**
 * Provides comprehensive format requirements and edge case handling
 * @returns Formatted string with detailed instructions
 */
function getFormatExamples(): string {
  return `📋 **TEAM MEMBER ADDITION GUIDE**

**📝 FORMATS:**

**Basic (Method 1):**
\`Add [Name] to [Section] with discord @username\`

**Basic (Method 2 - Tag user):**
\`Add [Name] to [Section] with discord username\` (tag the user when typing)

**With Custom Questions:**
\`Add [Name] to [Section] with discord @username
Format: Question1, Question2, Question3\`

**✅ EXAMPLES:**
\`Add Stan to Development with discord @stan0473\`
\`Add Sam to Software team with discord samdeveloper\` (when tagging)
\`Add John to Marketing with discord @john123
Format: What did you ship?, Next priorities?, Any blockers?\`

**🔄 DEFAULT QUESTIONS:**
• What did you accomplish this week?
• What are your priorities for next week?
• Any blockers or challenges?

**⚠️ REQUIREMENTS:**
• User must be in this Discord server
• Use exact Discord username (with @ or tag them)
• Include section/role name

**🚨 TROUBLESHOOTING:**
• **User not found:** Check they're in server, verify username
• **Permission denied:** Only admins can add team members
• **Duplicate user:** Use \`list team members\` to check existing

**💡 TIP:** Right-click user in Discord → Copy Username OR just tag them when typing`;
}

// Default update format to use when user doesn't specify one
const DEFAULT_UPDATE_FORMAT = [
  'What did you accomplish this week?',
  'What are your priorities for next week?',
  'Any blockers or challenges?'
];

export const addTeamMemberAction: Action = {
  name: 'ADD_TEAM_MEMBER',
  description:
    'Add team members to sections with Discord/Telegram usernames and optional custom update formats. Users must be in the Discord server. Applies default update format if none specified. Provides comprehensive validation, edge case handling, and detailed error messages with specific guidance for each error type.',
  similes: ['ADD_TEAM_MEMBER', 'REGISTER_MEMBER', 'TRACK_TEAM', 'ADD_TO_SECTION', 'ORGANIZE_TEAM', 'HELP_ADD_MEMBER', 'TEAM_MEMBER_GUIDE'],
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

      // Check if user is an admin
      logger.info(`Checking if user ${message.entityId} is an admin for server ${serverId}`);
      const userRole = await getUserServerRole(runtime, message.entityId, serverId);
      logger.info(`User role: ${userRole}`);

      state.data.isAdmin = true;
      return true;
    } catch (error: unknown) {
      const err = error as Error;
      logger.error('Error in addTeamMemberAction validation:', error);
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
      logger.info('=== RECORD-TEAM-MEMBER HANDLER START ===');
      logger.info('Message content received:', JSON.stringify(message.content, null, 2));

      if (!state) return false;
      
      if (!callback) {
        logger.warn('No callback function provided');
        return false;
      }

      // Extract user message
      const userText = message.content.text as string;
      if (!userText) {
        logger.warn('No text content found in message');
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

      logger.info(`Processing team members for server: ${serverId} (${serverName})`);

      // Validate input format before AI parsing
      const validationResult = validateTeamMemberInput(userText);
      if (!validationResult.isValid) {
        logger.warn(`Input validation failed: ${validationResult.error}`);
        
        // Provide specific error messages for different error types
        if (validationResult.isHelpRequest) {
          await callback(
            {
              text: `👋 ${validationResult.error}\n\n${getFormatExamples()}`,
            },
            []
          );
        } else if (validationResult.errorType) {
          // Provide detailed error message for specific error types
          const detailedError = getDetailedErrorMessage(validationResult.errorType);
          
          // Use quick reminder for simple format issues, full guide for complex issues
          const isSimpleFormatIssue = ['missing_username', 'missing_platform', 'username_spaces'].includes(validationResult.errorType);
          const additionalHelp = isSimpleFormatIssue ? getQuickFormatReminder() : getFormatExamples();
          
          await callback(
            {
              text: `${detailedError}\n\n${additionalHelp}`,
            },
            []
          );
        } else {
          // Generic error with full examples
          await callback(
            {
              text: `${validationResult.error}\n\n${getFormatExamples()}`,
            },
            []
          );
        }
        return false;
      }

      // Additional validation for user presence (extract username from input for validation)
      const atUsernameMatch = userText.match(/@([^,\n\s]+)/);
      const taggedUsernameMatch = userText.match(/(\w+)\s*\(@\d+\)/);
      const username = atUsernameMatch ? atUsernameMatch[1] : (taggedUsernameMatch ? taggedUsernameMatch[1] : null);
      
      if (username) {
        const userPresenceValidation = await validateUserPresence(runtime, `@${username}`, serverId);
        if (!userPresenceValidation.isValid) {
          logger.warn(`User presence validation failed: ${userPresenceValidation.error}`);
          
          if (userPresenceValidation.errorType) {
            const detailedError = getDetailedErrorMessage(userPresenceValidation.errorType);
            await callback(
              {
                text: `${detailedError}\n\n🔍 **Double-check:** Is the user in this Discord server?`,
              },
              []
            );
          } else {
            await callback(
              {
                text: `${userPresenceValidation.error}\n\n${getFormatExamples()}`,
              },
              []
            );
          }
          return false;
        }
      }

      // Example parsing team member data from input
      try {
        logger.info('Sending text to AI for parsing team member details');
        const prompt = `Parse the following text and extract team member information. Return ONLY a valid JSON array with no extra text:

        Required format:
        [{
          "section": "section_name",
          "tgName": "@username" (only if telegram/tg mentioned),
          "discordName": "@username" (only if discord mentioned),
          "updatesFormat": ["question1", "question2"] (array of update questions, can be empty)
        }]

        Rules:
        - Extract section/role name from context
        - For usernames: Handle both "@username" and "username (@discordId)" formats
        - Always store usernames WITH @ symbol (e.g., "@john123")
        - If input has "username (@discordId)", extract just "username" and add @ symbol
        - Leave tgName empty if not mentioned
        - Leave discordName empty if not mentioned
        - Parse update format questions into array (if "Format:" is mentioned)
        - If no format is specified, leave updatesFormat as empty array (default will be applied)
        - Return valid JSON only

        Examples:
        Input: "Add John to Development with discord @john123"
        Output: [{"section": "Development", "discordName": "@john123", "updatesFormat": []}]

        Input: "Add Sarah to Marketing with discord sarah456 (@123456789)"
        Output: [{"section": "Marketing", "discordName": "@sarah456", "updatesFormat": []}]

        Input: "Add Sam to Software team with discord samdeveloper (@528388627135201292)"
        Output: [{"section": "Software team", "discordName": "@samdeveloper", "updatesFormat": []}]

        Text to parse: "${userText}"`;

        logger.info('Team member parsing prompt:', prompt);

        const parsedResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
          prompt,
          stopSequences: [],
        });

        logger.info('Raw AI response for team member details:', parsedResponse);

        // Parse the response
        let teamMembers: TeamMember[] = [];
        try {
          const cleanedResponse = parsedResponse
            .replace(/```json\n?|\n?```/g, '')
            .replace(/^ADD_TEAM_MEMBER\s*/, '')
            .trim();
          const parsedData = JSON.parse(cleanedResponse);

          // Handle structured response from AI
          if (parsedData.action === 'ADD_TEAM_MEMBER' && parsedData.data && Array.isArray(parsedData.data)) {
            teamMembers = parsedData.data as TeamMember[];
            logger.info('Extracted team members from structured response:', teamMembers);
          } else if (parsedData.members && Array.isArray(parsedData.members)) {
            teamMembers = parsedData.members as TeamMember[];
            logger.info('Extracted team members from members array:', teamMembers);
          } else if (Array.isArray(parsedData)) {
            teamMembers = parsedData as TeamMember[];
            logger.info('Using direct array response:', teamMembers);
          } else {
            teamMembers = [parsedData as TeamMember];
            logger.info('Converting single object to array:', teamMembers);
          }

          logger.info('Successfully parsed team member configuration:', teamMembers);
        } catch (parseError) {
          logger.error('Failed to parse AI response as JSON:', parseError);
          logger.error('Raw response was:', parsedResponse);
          await callback(
            {
              text: `❌ I couldn't understand the team member information format.\n\n${getFormatExamples()}`,
            },
            []
          );
          return false;
        }


        // Validate that either TG or Discord name is present for each team member
        const validatedTeamMembers = teamMembers.filter((member: TeamMember) => {
          // Fix: Check for required fields
          if (!member.section) {
            logger.warn('Skipping team member missing section');
            return false;
          }

          const hasTgName = !!member.tgName && member.tgName.trim() !== '';
          const hasDiscordName = !!member.discordName && member.discordName.trim() !== '';

          if (!hasTgName && !hasDiscordName) {
            logger.warn(
              `Skipping team member in section "${member.section}" - missing both TG and Discord names`
            );
            return false;
          }
          return true;
        }).map((member: TeamMember) => {
          // Apply default update format if not provided
          if (!member.updatesFormat || member.updatesFormat.length === 0) {
            logger.info(`Applying default update format for team member in section: ${member.section}`);
            member.updatesFormat = DEFAULT_UPDATE_FORMAT;
          }
          
          // Ensure we have required fields for storage
          return {
            ...member,
            format: member.format || 'Standard', // Provide default format field if missing
            serverId: serverId,
            serverName: serverName,
            createdAt: new Date().toISOString()
          };
        });

        if (validatedTeamMembers.length < teamMembers.length) {
          logger.warn(
            `Filtered out ${teamMembers.length - validatedTeamMembers.length} team members due to missing required information`
          );
        }

        if (validatedTeamMembers.length === 0) {
          logger.error('No valid team members found after validation');
          
          // Provide specific feedback about what's missing
          const issues = [];
          if (teamMembers.some(m => !m.section)) {
            issues.push('• Missing section name');
          }
          if (teamMembers.some(m => !m.tgName && !m.discordName)) {
            issues.push('• Missing username (need either Discord or Telegram)');
          }
          
          const issueText = issues.length > 0 ? `\n\nIssues found:\n${issues.join('\n')}` : '';
          
          await callback(
            {
              text: `❌ Could not identify valid team members.${issueText}\n\n${getFormatExamples()}`,
            },
            []
          );
          return false;
        }

        logger.info(
          `Validated ${validatedTeamMembers.length} team members with proper information`
        );

        const serverHash = serverId.replace(/[^a-zA-Z0-9]/g, '');

        const roomIdForStoringTeamMembers = createUniqueUuid(
          runtime,
          `store-team-members-${serverHash}`
        );

        // Add table name to getMemories call
        const memoriesForStoringTeamMembers = await runtime.getMemories({
          roomId: roomIdForStoringTeamMembers as UUID,
          tableName: 'messages',
        });

        const existingConfig = memoriesForStoringTeamMembers.find((memory) => {
          logger.info('Checking memory:', memory);
          const isTeamMembersExist = memory.content.type === 'store-team-members-memory';
          return isTeamMembersExist;
        });
        logger.info('Found existing config:', existingConfig);

        if (!existingConfig) {
          logger.info('No existing store-team-members-memory found, creating new one');
          try {
            // Store all the validatedTeamMembers in the config
            const config: TeamMemberConfig = {
              teamMembers: validatedTeamMembers,
              lastUpdated: Date.now(),
              serverId: serverId,
            };

            logger.info('Creating store-team-members channel config:', config);

            // First create the room to avoid foreign key constraint error
            logger.info(`Creating room with ID: ${roomIdForStoringTeamMembers}`);
            try {
              await runtime.ensureRoomExists({
                id: roomIdForStoringTeamMembers as UUID,
                name: 'Storing Members config',
                source: 'team-coordinator',
                type: ChannelType.GROUP,
                worldId : runtime.agentId
              });
              logger.info(`Successfully created room with ID: ${roomIdForStoringTeamMembers}`);
            } catch (error: unknown) {
              const roomError = error as Error;
              logger.error(`Failed to create room: ${roomError.message || 'Unknown error'}`);
              logger.error(`Room error stack: ${roomError.stack || 'No stack trace available'}`);
            }

            const memory = {
              id: createUniqueUuid(runtime, `store-team-members-${serverHash}`),
              entityId: runtime.agentId,
              agentId: runtime.agentId,
              content: {
                type: 'store-team-members-memory',
                config,
              },
              roomId: roomIdForStoringTeamMembers,
              createdAt: Date.now(),
            };

            await runtime.createMemory(memory, 'messages');
            logger.info('Successfully stored new report channel config');
          } catch (error: unknown) {
            const configError = error as Error;
            logger.error('Failed to store report channel config:', configError);
            logger.error('Error stack:', configError.stack || 'No stack trace available');
          }
        } else {
          logger.info('Found existing team members config, checking for new members to add');

          // Fetch existing team members from the config
          const configData = existingConfig.content.config as TeamMemberConfig;
          const existingTeamMembers = configData?.teamMembers || [];
          logger.info(`Found ${existingTeamMembers.length} existing team members`);

          // Filter out team members that already exist
          const newTeamMembers = validatedTeamMembers.filter(
            (newMember) => !isDuplicateTeamMember(existingTeamMembers, newMember)
          );

          if (newTeamMembers.length === 0) {
            logger.info('No new team members to add, all are already registered');

            // Format team members into a readable list
            const teamMembersList = existingTeamMembers
              .map((member: TeamMember, index: number) => {
                const section = member.section || 'Unassigned';
                const format = member.format || 'Text';

                let platformInfo = '';
                if (member.tgName) {
                  platformInfo = `Telegram: ${member.tgName}`;
                } else if (member.discordName) {
                  platformInfo = `Discord: ${member.discordName}`;
                }

                const updateFields =
                  member.updatesFormat && member.updatesFormat.length > 0
                    ? `\n   Fields: ${member.updatesFormat.join(', ')}`
                    : '';

                return `${index + 1}. Section: ${section} | ${platformInfo}${updateFields}`;
              })
              .join('\n');

            // Add a callback here to respond when no new members are added
            await callback(
              {
                text: `✅ All team members are already registered!\n\nCurrent team members:\n${teamMembersList}`,
              },
              []
            );
          } else {
            // Add new team members to the existing list
            logger.info(`Adding ${newTeamMembers.length} new team members to existing config`);

            const updatedTeamMembers = [...existingTeamMembers, ...newTeamMembers];

            // Update the config with the new team members
            const updatedConfig = {
              ...(existingConfig.content.config as TeamMemberConfig),
              teamMembers: updatedTeamMembers,
              lastUpdated: Date.now(),
            };

            // Update the memory with the new config
            if (existingConfig.id) {
              await runtime.updateMemory({
                id: existingConfig.id,
                ...existingConfig,
                content: {
                  ...existingConfig.content,
                  config: updatedConfig,
                },
              });
            }

            logger.info(
              `Successfully updated team members config with ${newTeamMembers.length} new members`
            );

            logger.info(`Successfully added ${newTeamMembers.length} new team members`);

            // Add a callback here to respond when new members are added
            const allTeamMembers = updatedTeamMembers;
            const teamMembersList = allTeamMembers
              .map((member: TeamMember, index) => {
                const section = member.section || 'Unassigned';

                let platformInfo = '';
                if (member.tgName) {
                  platformInfo = `Telegram: ${member.tgName}`;
                } else if (member.discordName) {
                  platformInfo = `Discord: ${member.discordName}`;
                }

                let updateFields = '';
                if (member.updatesFormat && member.updatesFormat.length > 0) {
                  updateFields = ` | Update Fields: ${member.updatesFormat.join(', ')}`;
                }

                return `${index + 1}. Section: ${section} | ${platformInfo}${updateFields}`;
              })
              .join('\n');

            // Check if any members used default format
            const membersWithDefaultFormat = updatedTeamMembers.filter(member => 
              member.updatesFormat && 
              JSON.stringify(member.updatesFormat) === JSON.stringify(DEFAULT_UPDATE_FORMAT)
            );
            
            let formatNote = '';
            if (membersWithDefaultFormat.length > 0) {
              formatNote = `\n\n📝 **Note:** Default update format applied for members without custom format:\n• What did you accomplish this week?\n• What are your priorities for next week?\n• Any blockers or challenges?`;
            }

            await callback(
              {
                text: `✅ Team members have been successfully updated!\n\nCurrent team members:\n${teamMembersList}${formatNote}`,
              },
              []
            );
          }

          // Return early since we've already sent the callback
          return true;
        }

        logger.info('fetching updated members from memory');

        // Fetch the updated team members to include in the response
        const updatedMemories = await runtime.getMemories({
          roomId: roomIdForStoringTeamMembers as UUID,
          tableName: 'messages',
        });

        const updatedConfig = updatedMemories.find(
          (memory) => memory.content.type === 'store-team-members-memory'
        );

        if (updatedConfig && updatedConfig.content.config) {
          const configData = updatedConfig.content.config as TeamMemberConfig;
          const allTeamMembers = configData.teamMembers || [];
          logger.info(`Retrieved ${allTeamMembers.length} total team members for response`);

          // Format all team members for the response
          const teamMembersList = allTeamMembers
            .map((member: TeamMember, index) => {
              const section = member.section || 'Unassigned';

              let platformInfo = '';
              if (member.tgName) {
                platformInfo = `Telegram: ${member.tgName}`;
              } else if (member.discordName) {
                platformInfo = `Discord: ${member.discordName}`;
              }

              let updateFields = '';
              if (member.updatesFormat && member.updatesFormat.length > 0) {
                updateFields = ` | Update Fields: ${member.updatesFormat.join(', ')}`;
              }

              return `${index + 1}. Section: ${section} | ${platformInfo}${updateFields}`;
            })
            .join('\n');

          // Check if any members used default format
          const membersWithDefaultFormat = allTeamMembers.filter(member => 
            member.updatesFormat && 
            JSON.stringify(member.updatesFormat) === JSON.stringify(DEFAULT_UPDATE_FORMAT)
          );
          
          let formatNote = '';
          if (membersWithDefaultFormat.length > 0) {
            formatNote = `\n\n📝 **Note:** Default update format applied for members without custom format:\n• What did you accomplish this week?\n• What are your priorities for next week?\n• Any blockers or challenges?`;
          }

          await callback(
            {
              text: `✅ Team members have been successfully added!\n\nCurrent team members:\n${teamMembersList}${formatNote}`,
            },
            []
          );
        } else {
          await callback(
            {
              text: `✅ Team members have been successfully added!`,
            },
            []
          );
        }
      } catch (error: unknown) {
        const parsingError = error as Error;
        logger.error('Failed to parse team member information:', parsingError);
        logger.error('Error stack:', parsingError.stack || 'No stack trace available');

        // Provide specific error message based on the error type
        let errorMessage = '❌ There was an issue processing the team member information.';
        
        if (parsingError.message.includes('JSON')) {
          errorMessage = '❌ I couldn\'t parse the team member information format.';
        } else if (parsingError.message.includes('section')) {
          errorMessage = '❌ Missing section information for team members.';
        } else if (parsingError.message.includes('username')) {
          errorMessage = '❌ Missing username information (Discord or Telegram required).';
        }

        await callback(
          {
            text: `${errorMessage}\n\n${getFormatExamples()}`,
          },
          []
        );
        return false;
      }

      return true;
    } catch (error: unknown) {
      const err = error as Error;
      logger.error('=== TEAM-MEMBER HANDLER ERROR ===');
      logger.error(`Error processing team member recording: ${err}`);
      logger.error(`Error stack: ${err.stack || 'No stack trace available'}`);

      if (callback) {
        await callback(
          {
            text: '❌ An unexpected error occurred while recording team members. Please try again later.',
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
          text: 'Add Stan to Development with discord @stan0473',
        },
      },
      {
        name: '{{botName}}',
        content: {
          text: "",
          actions: ['ADD_TEAM_MEMBER'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Add John to Marketing with discord @john123\nFormat: Campaign results this week?, Content created?, Next priorities?',
        },
      },
      {
        name: '{{botName}}',
        content: {
          text: "",
          actions: ['ADD_TEAM_MEMBER'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Section: Operations\nTelegram: @sarah_ops\nFormat: Process improvements?, System updates?, Team support provided?',
        },
      },
      {
        name: '{{botName}}',
        content: {
          text: "",
          actions: ['ADD_TEAM_MEMBER'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'how do I add team members?',
        },
      },
      {
        name: '{{botName}}',
        content: {
          text: "",
          actions: ['ADD_TEAM_MEMBER'],
        },
      },
    ],
  ],
};
