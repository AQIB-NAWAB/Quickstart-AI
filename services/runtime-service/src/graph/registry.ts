import type { GraphNodeType } from "@quickstart/contracts";
import type { GraphNodeHandler } from "./types.js";
import { EntrypointHandler } from "./handlers/entrypoint.handler.js";
import { WelcomeHandler } from "./handlers/welcome.handler.js";
import { ConversationHandler } from "./handlers/conversation.handler.js";
import { IntentRouterHandler } from "./handlers/intent-router.handler.js";
import { ConditionHandler } from "./handlers/condition.handler.js";
import { AiPromptHandler } from "./handlers/ai-prompt.handler.js";
import { HttpRequestHandler } from "./handlers/http-request.handler.js";
import { KnowledgeSearchHandler } from "./handlers/knowledge-search.handler.js";
import { ResponseHandler } from "./handlers/response.handler.js";
import { HumanHandoffHandler } from "./handlers/human-handoff.handler.js";
import { EndConversationHandler } from "./handlers/end-conversation.handler.js";
import type { ModelGatewayClient } from "../clients/model-gateway.client.js";
import type { ToolExecutor } from "../services/tool-executor.js";
import type { KnowledgeClient } from "../clients/knowledge.client.js";
import type { ConversationClient } from "../clients/conversation.client.js";
import type { MemoryClient } from "../clients/memory.client.js";
import type { AgentClient } from "../clients/agent.client.js";
import type { ToolLoop } from "../services/tool-loop.js";

export type HandlerRegistryDeps = {
  modelGateway?: ModelGatewayClient;
  toolExecutor?: ToolExecutor;
  knowledgeClient?: KnowledgeClient;
  conversationClient?: ConversationClient;
  memoryClient?: MemoryClient;
  agentClient?: AgentClient;
  toolLoop?: ToolLoop;
};

export class GraphNodeRegistry {
  private handlers = new Map<GraphNodeType, GraphNodeHandler<any>>();

  constructor(deps: HandlerRegistryDeps = {}) {
    this.register(new EntrypointHandler());
    this.register(new WelcomeHandler());
    this.register(new ConversationHandler(deps.modelGateway));
    this.register(new IntentRouterHandler(deps.modelGateway));
    this.register(new ConditionHandler());
    this.register(
      new AiPromptHandler(
        deps.modelGateway,
        deps.knowledgeClient,
        deps.memoryClient,
        deps.agentClient,
        deps.toolLoop,
      ),
    );
    this.register(new HttpRequestHandler(deps.toolExecutor));
    this.register(new KnowledgeSearchHandler(deps.knowledgeClient));
    this.register(new ResponseHandler());
    this.register(new HumanHandoffHandler(deps.conversationClient));
    this.register(new EndConversationHandler());
  }

  register<T extends GraphNodeType>(handler: GraphNodeHandler<T>): void {
    this.handlers.set(handler.type, handler);
  }

  get<T extends GraphNodeType>(type: T): GraphNodeHandler<T> | undefined {
    return this.handlers.get(type);
  }
}
