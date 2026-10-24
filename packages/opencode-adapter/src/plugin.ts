import { type Plugin, type Config } from "@opencode-ai/plugin"
import { loadPluginConfig } from "./plugin-config.ts"
import {
  registerConsultantAgent,
  registerConsultationCritic,
  registerExplorer,
  registerAnalyst,
  registerCoder,
  registerLite,
  registerCoderLite,
  registerVerifier,
  registerWriter,
  registerJanus,
} from "./agent-registration.ts"
import { createJanusDispatchTools } from "./dispatch-tool.ts"
import { registerMemoryMcp } from "./mcp-registration.ts"
import { installConsultationSkill } from "./skill-installer.ts"
import { installMemoryCommands } from "./command-installer.ts"
import { computeNamespace } from "./namespace.ts"

/**
 * Create the config hook that registers the agent family, the
 * janus-memory MCP server, and the consultation skill.
 *
 * Exported separately from the plugin so tests can invoke the hook
 * without constructing a full `PluginInput`.
 */
export function createJanusConfigHook(
  project: { id: string },
  directory: string,
): (config: Config) => Promise<void> {
  return async (config: Config): Promise<void> => {
    const env = process.env
    const pluginConfig = await loadPluginConfig(env)
    const namespace = computeNamespace(project.id, directory)

    await registerConsultantAgent(config, pluginConfig, namespace)

    if (pluginConfig.coder_enabled) {
      await registerCoder(config, pluginConfig)
    }

    if (pluginConfig.lite_enabled) {
      await registerLite(config, pluginConfig, namespace)
    }

    if (pluginConfig.coder_lite_enabled) {
      await registerCoderLite(config, pluginConfig)
    }

    if (pluginConfig.janus_enabled) {
      await registerJanus(config, pluginConfig)
    }

    await registerExplorer(config, pluginConfig)
    await registerAnalyst(config, pluginConfig)

    if (pluginConfig.critic_enabled) {
      await registerConsultationCritic(config, pluginConfig)
    }

    if (pluginConfig.verifier_enabled) {
      await registerVerifier(config, pluginConfig)
    }

    if (pluginConfig.writer_enabled) {
      await registerWriter(config, pluginConfig)
    }

    if (pluginConfig.memory_enabled) {
      registerMemoryMcp(config, pluginConfig, namespace)
    }

    if (pluginConfig.install_skill) {
      await installConsultationSkill(env)
    }

    if (pluginConfig.install_commands) {
      await installMemoryCommands(env)
    }
  }
}

/**
 * The janus-agent OpenCode plugin.
 *
 * Uses only the `config` hook to register the `consultant` primary agent,
 * the `janus-memory` local MCP server, and the `consultation` skill.
 * Contains no evidence, recommendation, or persistence logic.
 */
export const JanusAgentPlugin: Plugin = async (input) => ({
  config: createJanusConfigHook(input.project, input.directory),
  tool: createJanusDispatchTools(input.client),
})
