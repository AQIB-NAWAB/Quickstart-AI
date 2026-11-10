import type { Metadata } from "next";
import { RequestAccess } from "@/features/marketing/components/request-access";

export const metadata: Metadata = {
  title: "Request access — QuickStart AI",
  description: "Request early access and try the QuickStart AI voice assistant.",
};

export default function RequestAccessPage() {
  return <RequestAccess />;
}
