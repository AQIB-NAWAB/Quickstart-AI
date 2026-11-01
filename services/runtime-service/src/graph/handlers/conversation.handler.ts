import type {
  AgentGraphNode,
  ConversationNodeConfig,
  CapturedFieldDefinition,
} from "@quickstart/contracts";
import type { ExecutionContext, GraphNodeHandler, NodeExecutionResult } from "../types.js";
import { setVariablePath, resolveVariablePath } from "../eval-utils.js";
import type { ModelGatewayClient } from "../../clients/model-gateway.client.js";

export class ConversationHandler implements GraphNodeHandler<"conversation"> {
  type = "conversation" as const;

  constructor(_modelGateway?: ModelGatewayClient) {}

  async execute(
    node: AgentGraphNode<"conversation">,
    ctx: ExecutionContext,
  ): Promise<NodeExecutionResult> {
    const config = node.config as ConversationNodeConfig & { capture_variable?: string };
    const configuredFields = config.captured_fields?.length
      ? config.captured_fields
      : config.capture_variable
        ? [
            {
              variable: config.capture_variable,
              type: "text" as const,
              required: true,
              field_name: config.capture_variable,
            },
          ]
        : [];
    const capturedFields = configuredFields.map((field) => ({
      ...field,
      allowed_values: field.allowed_values?.length
        ? field.allowed_values
        : this.inferAllowedValues(node, field.variable, ctx),
    }));
    const requiredFields = capturedFields.filter((f) => f.required);
    let variables = { ...(ctx.sessionState.variables || {}) };
    const visitorText = ctx.visitorMessage?.trim() || "";

    // Check if visitor explicitly requested human or assistance
    if (
      /(speak to (a person|someone|human|agent|receptionist|operator)|help me|transfer me|talk to a human)/i.test(
        visitorText,
      )
    ) {
      return {
        status: "succeeded",
        chosenBranchPort: "needs_assistance",
      };
    }

    // Extract fields from visitor text
    const requestedField =
      (ctx.sessionState.wait_state?.node_id === node.id
        ? ctx.sessionState.wait_state.captured_fields?.[0]
        : undefined) ??
      requiredFields.find((field) => {
        const value = resolveVariablePath(field.variable, variables);
        return value === undefined || value === null || value === "";
      })?.variable;

    if (visitorText && capturedFields.length > 0) {
      variables = this.extractFields(visitorText, capturedFields, variables, requestedField);
    }

    // Check completion criteria
    const missingFields: CapturedFieldDefinition[] = [];
    for (const field of requiredFields) {
      const val = resolveVariablePath(field.variable, variables);
      if (val === undefined || val === null || val === "") {
        missingFields.push(field);
      }
    }

    // `continue_when` controls the node's transition policy after the
    // conversation is complete; it must never bypass required capture fields.
    // Doing so made graph agents advance with invented/missing values.
    if (missingFields.length === 0) {
      return {
        status: "succeeded",
        chosenBranchPort: "details_complete",
        outputVariables: variables,
      };
    }

    // Still missing required fields -> ask for the next missing field
    const nextField = missingFields[0];
    const prompt = this.generateFieldPrompt(nextField, node.name);

    if (ctx.onAssistantMessage) {
      await ctx.onAssistantMessage(prompt);
    }

    return {
      status: "waiting_for_input",
      waitForFields: [nextField.variable],
      outputVariables: variables,
      assistantMessage: prompt,
    };
  }

  private extractFields(
    text: string,
    fieldDefs: CapturedFieldDefinition[],
    currentVars: Record<string, unknown>,
    requestedField?: string,
  ): Record<string, unknown> {
    let updated = { ...currentVars };

    for (const def of fieldDefs) {
      const existing = resolveVariablePath(def.variable, updated);
      if (existing !== undefined && existing !== null && existing !== "") {
        continue; // preserve already supplied values
      }

      if (def.type === "text" && /name|person|customer/i.test(def.variable)) {
        // Do not turn an answer for another field (for example "tomorrow")
        // into a person's name just because this is the first missing field.
        const dateLike =
          /\b(?:today|tomorrow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
            text,
          ) ||
          /^\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?$/.test(text.trim());
        if (dateLike) continue;
        const nameMatch = text.match(/(?:my name is|i am|this is|name:\s*)\s*([A-Za-z][A-Za-z\s'-]{1,120})/i);
        if (nameMatch) {
          updated = setVariablePath(def.variable, nameMatch[1].trim(), updated);
        } else if (def.variable === requestedField && /^[A-Za-z][A-Za-z\s'-]{1,120}$/.test(text.trim())) {
          updated = setVariablePath(def.variable, text.trim(), updated);
        }
      } else if (def.variable === requestedField && def.type === "text") {
        const acceptedValue = this.matchAllowedValue(text, def.allowed_values ?? []);
        if (def.allowed_values?.length && !acceptedValue) continue;
        updated = setVariablePath(def.variable, acceptedValue ?? text.slice(0, 500), updated);
      } else if (def.type === "email") {
        const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
        if (email) updated = setVariablePath(def.variable, email[0], updated);
      } else if (
        def.type === "number" &&
        def.variable === requestedField &&
        /^-?\d+(?:\.\d+)?$/.test(text)
      ) {
        updated = setVariablePath(def.variable, Number(text), updated);
      } else if (
        def.type === "boolean" &&
        def.variable === requestedField &&
        /^(yes|no|true|false)$/i.test(text)
      ) {
        updated = setVariablePath(def.variable, /^(yes|true)$/i.test(text), updated);
      } else if (def.type === "phone") {
        const phoneMatch = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
        if (phoneMatch) {
          updated = setVariablePath(def.variable, phoneMatch[0].trim(), updated);
        }
      } else if (def.type === "date") {
        const dateMatch = text.match(
          /\b(?:tomorrow|today|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{2}-\d{2})\b/i,
        );
        if (dateMatch) {
          updated = setVariablePath(def.variable, dateMatch[0].trim(), updated);
        }
      }
    }

    return updated;
  }

  private generateFieldPrompt(field: CapturedFieldDefinition, _nodeName: string): string {
    const label = field.variable.replace(/^.*[._]/, "").replace(/_/g, " ");
    if (field.allowed_values?.length) {
      return `Please answer with ${field.allowed_values.join(" or ")}.`;
    }
    if (field.type === "phone") {
      return `Could you please provide your phone number so we can reach you?`;
    }
    if (field.type === "date") {
      return `What date or time would work best for you?`;
    }
    return `Could you please share your ${label}?`;
  }

  private matchAllowedValue(text: string, allowedValues: string[]): string | undefined {
    const normalized = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    for (const value of allowedValues) {
      const option = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
      if (!option) continue;
      if (normalized === option || ` ${normalized} `.includes(` ${option} `)) {
        const occurrence = normalized.indexOf(option);
        const before = normalized.slice(0, occurrence).trim().split(/\s+/).slice(-2).join(" ");
        if (/^(?:not|not a|not an|isnt|isnt a|isnt an)$/.test(before)) continue;
        return value;
      }
    }
    return undefined;
  }

  private inferAllowedValues(
    node: AgentGraphNode<"conversation">,
    variable: string,
    ctx: ExecutionContext,
  ): string[] {
    const ruleValues = ctx.graph.nodes
      .filter((candidate) => candidate.type === "condition")
      .flatMap((candidate) => {
        const rules =
          (
            candidate.config as {
              rules?: Array<{ variable?: string; operator?: string; value?: unknown }>;
            }
          ).rules ?? [];
        return rules
          .filter(
            (rule) =>
              rule.variable === variable &&
              rule.operator === "equals" &&
              typeof rule.value === "string",
          )
          .map((rule) => rule.value as string);
      });
    if (!ruleValues.length || !/type|kind|category/i.test(variable)) return [];

    const prompt = ctx.graph.edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => ctx.graph.nodes.find((candidate) => candidate.id === edge.source))
      .find((candidate) => candidate?.type === "response");
    const promptText = prompt
      ? String(
          (prompt.config as { message?: string; fixed_text?: string }).message ??
            (prompt.config as { fixed_text?: string }).fixed_text ??
            "",
        )
      : "";
    const alternatives = promptText.match(/\b([\w ]+?)\s+or\s+([\w ]+?)[?.!]?$/i);
    if (!alternatives) return [...new Set(ruleValues)];

    const phrases = [alternatives[1], alternatives[2]].map((phrase) =>
      phrase
        .toLowerCase()
        .replace(/^(?:are you|is it)\s+/i, "")
        .replace(/^(?:a|an|the)\s+/i, "")
        .trim(),
    );
    const values = new Set(ruleValues);
    for (const phrase of phrases) {
      const known = ruleValues.find((value) => phrase.includes(value.toLowerCase()));
      if (!known) {
        const words = phrase
          .split(/\s+/)
          .filter((word) => !["a", "an", "the", "customer"].includes(word));
        if (words.length) values.add(words.at(-1)!);
      }
    }
    return [...values];
  }
}
