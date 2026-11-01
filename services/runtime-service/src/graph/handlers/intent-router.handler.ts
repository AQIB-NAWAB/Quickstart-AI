import { graphModel } from "../model-reference.js";
import type { AgentGraphNode, IntentRouterNodeConfig } from "@quickstart/contracts";
import type { ExecutionContext, GraphNodeHandler, NodeExecutionResult } from "../types.js";
import type { ModelGatewayClient } from "../../clients/model-gateway.client.js";

export class IntentRouterHandler implements GraphNodeHandler<"intent_router"> {
  type = "intent_router" as const;

  constructor(private readonly modelGateway?: ModelGatewayClient) {}

  async execute(
    node: AgentGraphNode<"intent_router">,
    ctx: ExecutionContext,
  ): Promise<NodeExecutionResult> {
    const config = node.config as IntentRouterNodeConfig;
    const visitorText = ctx.visitorMessage?.trim() || "";

    if (!visitorText || !Array.isArray(config.intents) || config.intents.length === 0) {
      return {
        status: "succeeded",
        chosenBranchPort: "fallback",
      };
    }

    // 1. If rules-based routing is configured or fallback matching
    if (config.routing_method === "rules") {
      for (const intent of config.intents) {
        if (
          intent.condition &&
          visitorText.toLowerCase().includes(intent.condition.toLowerCase())
        ) {
          return {
            status: "succeeded",
            chosenBranchPort: `intent_${intent.id}`,
          };
        }
      }
      return {
        status: "succeeded",
        chosenBranchPort: "fallback",
      };
    }

    // 3. Fallback to model gateway if client is available
    if (this.modelGateway) {
      try {
        const declaredIntents = config.intents.map(
          (i) => `ID "${i.id}": ${i.name} - ${i.description}`,
        );
        const classificationPrompt = `Classify this visitor message into one of these intents:\n${declaredIntents.join("\n")}\n\nVisitor message: "${visitorText}"\nReply with ONLY the matching Intent ID, or "UNKNOWN":`;

        const resp = await this.modelGateway.complete(
          {
            workspace_id: ctx.workspaceId,
            request_id: ctx.requestId,
            agent_id: ctx.agentId,
            conversation_id: ctx.conversationId,
            channel: ctx.channel,
            model: graphModel(ctx, config.model_override),
            messages: [{ role: "user", content: classificationPrompt }],
            max_tokens: 20,
            temperature: 0.1,
          },
          ctx.abortSignal,
        );

        const reply = resp.content?.trim() || "";
        const matchedIntent = config.intents.find((i) => reply.replace(/^"|"$/g, "") === i.id);

        if (matchedIntent) {
          return {
            status: "succeeded",
            chosenBranchPort: `intent_${matchedIntent.id}`,
          };
        }
      } catch {
        // Fall through to fallback branch
      }
    }

    return {
      status: "succeeded",
      chosenBranchPort: "fallback",
    };
  }
}
