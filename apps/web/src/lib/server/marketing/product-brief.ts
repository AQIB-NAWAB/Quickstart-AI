import { FAQ_ITEMS } from "@/features/marketing/sections/faq/faq-content";

/** Product grounding for the public guide; derived from the landing page and repository README. */
export const PRODUCT_BRIEF = [
  "QuickStart AI is an early-access platform for building and operating AI agents for businesses. Some capabilities are still being developed; demos illustrate the intended experience, and individual features and availability should not be promised as generally available.",
  "The platform is designed for agents configured with instructions, tools, models, and business knowledge, including documents. A visual builder and testing workflow help teams set up and try agents; developer APIs and SDKs provide additional integration options.",
  "Planned and implemented product areas include embeddable website chat, voice conversations with supported providers, inbound and outbound calls, campaigns, business lead research and qualification, and app integrations.",
  "A shared inbox lets a team review conversations and take over or return a conversation to the agent. Workspaces organize agents, access, knowledge, and operations. The project includes monitoring and usage capabilities.",
  "Access is currently requested through this page and reviewed by the team. Pricing, included usage, launch dates, and availability are not final. Do not promise approval, timing, feature readiness, specific integrations, or pricing.",
  ...FAQ_ITEMS.map(({ question, answer }) => `${question} ${answer}`),
].join("\n");
