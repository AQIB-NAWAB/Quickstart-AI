import type {
  AgentCatalogResponse,
  AgentModelCatalogItem,
  AgentToolCatalogItem,
} from "@quickstart/contracts";

const DEFAULT_MODELS: AgentModelCatalogItem[] = [
  { id: "gpt-6-luna", name: "GPT-6 Luna", provider: "OpenAI", description: "Fast, efficient model for low-latency agent turns", enabled: true, supports_tools: true, supports_vision: true },
  { id: "gpt-6.1-terra", name: "GPT-6.1 Terra", provider: "OpenAI", description: "Fast visual reasoning and precise tool workflows", enabled: true, supports_tools: true, supports_vision: true },
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", provider: "OpenAI", description: "Balanced high-quality reasoning at lower cost", enabled: true, supports_tools: true, supports_vision: true },
  { id: "gpt-6-astra", name: "GPT-6 Astra", provider: "OpenAI", description: "Highest-reasoning option for complex tool workflows", enabled: true, supports_tools: true, supports_vision: true },
  { id: "gpt-4o-mini", name: "GPT-4o mini", provider: "OpenAI", description: "Fast, cost-efficient, everyday queries", enabled: true, supports_tools: true },
  { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI", description: "Advanced reasoning and complex tool calls", enabled: true, supports_tools: true, supports_vision: true },
  { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", provider: "Anthropic", description: "Nuanced writing and instruction following", enabled: true, supports_tools: true },
  { id: "claude-3-haiku", name: "Claude 3 Haiku", provider: "Anthropic", description: "Fast, low-latency responses", enabled: true, supports_tools: true },
  { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", provider: "Groq", description: "High-throughput open model", enabled: true, supports_tools: true },
  { id: "meta/llama-3.2-11b-vision-instruct", name: "Llama 3.2 11B", provider: "Blueminds", description: "Fast multimodal open model", enabled: true, supports_tools: true, supports_vision: true },
];

const DEFAULT_TOOLS: AgentToolCatalogItem[] = [
  ["web_scrape", "Scrape a webpage", "Scrape public web page text", "builtin_web"],
  ["web_search", "Search the web", "Search current public information", "builtin_web"],
  ["leads_start_research", "Start research", "Start a business lead research run", "builtin_leads"],
  ["leads_run_status", "Check progress", "Check a lead research run", "builtin_leads"],
  ["leads_run_results", "Get results", "Fetch accepted research leads", "builtin_leads"],
  ["leads_cancel_run", "Cancel research", "Cancel a lead research run", "builtin_leads"],
  ["save_qualified_lead", "Save qualified lead", "Save a qualified conversation as a lead", "builtin_leads"],
  ["request_callback", "Request a callback", "Record a callback request", "builtin_leads"],
  ["check_calendar_availability", "Check calendar availability", "Check real open appointment slots", "builtin_calendar", true],
  ["book_calendar_slot", "Book an appointment", "Create an appointment after confirmation", "builtin_calendar", true],
  ["cancel_calendar_event", "Cancel an appointment", "Cancel an existing appointment", "builtin_calendar", true],
  ["create_support_ticket", "Create support ticket", "Create a Zendesk support ticket", "builtin_integration", true],
  ["get_support_ticket", "Look up support ticket", "Look up a Zendesk ticket", "builtin_integration", true],
  ["add_support_ticket_comment", "Comment on support ticket", "Add a Zendesk ticket comment", "builtin_integration", true],
  ["post_team_message", "Notify team in Slack", "Post a message to Slack", "builtin_integration", true],
  ["save_crm_contact", "Save CRM contact", "Create or update a CRM contact", "builtin_integration", true],
  ["create_salesforce_lead", "Create Salesforce lead", "Create a Salesforce lead", "builtin_integration", true],
  ["append_google_sheet_row", "Append Google Sheet row", "Append data to Google Sheets", "builtin_integration", true],
  ["add_mailchimp_subscriber", "Add Mailchimp subscriber", "Add a subscriber to Mailchimp", "builtin_integration", true],
  ["send_sms", "Send SMS", "Send an SMS through Twilio", "builtin_integration", true],
].map(([name, label, description, type, requiresConnection]) => ({
  name: name as string,
  label: label as string,
  description: description as string,
  type: type as AgentToolCatalogItem["type"],
  enabled: true,
  ...(requiresConnection ? { requires_connection: true } : {}),
}));

function readJson<T>(name: string, fallback: T): T {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getAgentCatalog(): AgentCatalogResponse {
  const models = readJson<AgentModelCatalogItem[]>("AGENT_MODEL_CATALOG_JSON", DEFAULT_MODELS)
    .filter((item) => item && typeof item.id === "string" && typeof item.name === "string");
  const tools = readJson<AgentToolCatalogItem[]>("AGENT_TOOL_CATALOG_JSON", DEFAULT_TOOLS)
    .filter((item) => item && typeof item.name === "string" && typeof item.type === "string");
  return { models, tools, generated_at: new Date().toISOString() };
}
