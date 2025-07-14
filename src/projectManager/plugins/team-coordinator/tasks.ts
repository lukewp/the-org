import {
  type IAgentRuntime,
  type UUID,
  logger,
  type Service,
} from "@elizaos/core";
import { TeamUpdateTrackerService } from "./services/updateTracker";

export const registerTasks = async (
  runtime: IAgentRuntime,
  initialWorldId?: UUID
) => {
  // Ensure worldId is set to the agent's ID if not provided
  const worldId = initialWorldId || (runtime.agentId as UUID);

  // Try to get an existing service instance instead of creating a new one
  let teamUpdateService: TeamUpdateTrackerService;
  try {
    const existingService = runtime.getService(
      TeamUpdateTrackerService.serviceType
    );
    if (existingService) {
      logger.info("Using existing TeamUpdateTrackerService");
      teamUpdateService = existingService as TeamUpdateTrackerService;
    } else {
      logger.info("Creating new TeamUpdateTrackerService instance");
      teamUpdateService = new TeamUpdateTrackerService(runtime);
    }
  } catch (error) {
    logger.warn(
      "Error getting existing service, creating new instance:",
      error
    );
    teamUpdateService = new TeamUpdateTrackerService(runtime);
  }

  // Clear existing tasks (with defensive check)
  try {
    if (runtime.getTasks && typeof runtime.getTasks === "function") {
      const tasks = await runtime.getTasks({
        tags: ["queue", "repeat", "team_coordinator"],
      });

      for (const task of tasks) {
        if (task.id) {
          await runtime.deleteTask(task.id);
        }
      }
    } else {
      logger.warn("getTasks method not available, skipping task cleanup");
    }
  } catch (error) {
    logger.warn("Error clearing existing tasks:", error);
    // Continue anyway
  }

  // Register the check-in service task worker
  runtime.registerTaskWorker({
    name: "TEAM_CHECK_IN_SERVICE",
    validate: async (_runtime, _message, _state) => {
      return true;
    },
    execute: async (runtime, _options, task) => {
      try {
        logger.info("Running team check-in service job");
        await teamUpdateService.checkInServiceJob();
      } catch (error) {
        logger.error("Failed to run check-in service job:", error);
      }
    },
  });

  // Create the periodic task (with defensive check)
  try {
    if (
      runtime.createTask &&
      typeof runtime.createTask === "function" &&
      runtime.adapter
    ) {
      runtime.createTask({
        name: "TEAM_CHECK_IN_SERVICE",
        description: "Regular team check-in service job",
        worldId: worldId, // Explicitly pass worldId
        metadata: {
          updatedAt: Date.now(),
          updateInterval: 1000 * 60 * 2, // 15 minutes - good balance between responsiveness and efficiency
        },
        tags: ["queue", "repeat", "team_coordinator"],
      });
      logger.info("Successfully created TEAM_CHECK_IN_SERVICE task");
    } else {
      logger.warn("Task adapter not ready, skipping task creation");
    }
  } catch (error) {
    logger.error("Error creating periodic task:", error);
    // Don't fail the entire registration process
  }
};
