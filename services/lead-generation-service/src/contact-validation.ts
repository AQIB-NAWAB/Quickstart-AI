/**
 * Truthful Contact Validation (Free Baseline Checks)
 *
 * Distinctly separates:
 * 1. Observed on source (found verbatim on page/document)
 * 2. Format checked (basic email syntax, plausible phone format)
 * 3. Domain mail routing checked (DNS MX, null MX rejection, A/AAAA fallback, transient DNS = unknown)
 * 4. Provider verified (only when verified by explicit customer-connected third-party provider)
 *
 * Never claims:
 * - Scraped email is deliverability-verified
 * - Formatted phone is active or owner-verified
 * - Bulk SMTP probing
 */

import { promises as dns } from "node:dns";

export type EmailValidationStatus =
  | "observed_only"
  | "format_invalid"
  | "domain_not_routable"  // null MX or NXDOMAIN
  | "domain_routable"      // Valid MX or valid A/AAAA fallback
  | "domain_unknown"       // DNS lookup transient failure
  | "provider_verified"
  | "provider_undeliverable";

export type PhoneValidationStatus =
  | "observed_only"
  | "format_invalid"
  | "numbering_plan_valid"   // Valid length & formatting for country
  | "numbering_plan_possible" // Plausible digits, country unknown
  | "provider_verified";

export type EmailValidationResult = {
  raw: string;
  normalized: string; // Preserves raw local-part casing, lowercases domain
  localPart: string;
  domain: string;
  formatValid: boolean;
  isRoleAccount: boolean;
  mailRoutingStatus: "routable" | "null_mx_rejected" | "domain_not_found" | "unknown";
  status: EmailValidationStatus;
  explanation: string;
  checkedAt: string;
};

export type PhoneValidationResult = {
  raw: string;
  normalized: string; // Stripped of whitespace/decorations, preserving leading +
  digitsOnly: string;
  countryCode?: string;
  formatValid: boolean;
  status: PhoneValidationStatus;
  explanation: string;
  checkedAt: string;
};

const ROLE_PREFIXES = new Set([
  "admin", "administrator", "info", "support", "help", "sales", "contact",
  "billing", "office", "team", "hello", "hi", "careers", "jobs", "press",
  "media", "legal", "security", "inquiries", "general", "marketing",
]);

// Conservative dot-atom syntax subset; quoted/internationalized mailboxes unsupported.
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Validates an email address syntax and domain mail routing without destructive local-part modification.
 */
export async function validateEmail(
  rawEmail: string,
  resolver: {
    resolveMx(host: string): Promise<Array<{ exchange: string; priority: number }>>;
    resolve4(host: string): Promise<string[]>;
    resolve6(host: string): Promise<string[]>;
  } = new dns.Resolver({ timeout: 1500, tries: 1 }),
): Promise<EmailValidationResult> {
  const trimmed = rawEmail.trim();
  const checkedAt = new Date().toISOString();

  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    return {
      raw: trimmed,
      normalized: trimmed,
      localPart: "",
      domain: "",
      formatValid: false,
      isRoleAccount: false,
      mailRoutingStatus: "domain_not_found",
      status: "format_invalid",
      explanation: "Email syntax is invalid (missing valid @ separator)",
      checkedAt,
    };
  }

  const localPart = trimmed.slice(0, atIndex);
  const domainPart = trimmed.slice(atIndex + 1).toLowerCase();
  const normalized = `${localPart}@${domainPart}`;

  if (!EMAIL_REGEX.test(normalized) || domainPart.length > 253 || localPart.length > 64 || normalized.length > 254 || localPart.startsWith(".") || localPart.endsWith(".") || localPart.includes("..")) {
    return {
      raw: trimmed,
      normalized,
      localPart,
      domain: domainPart,
      formatValid: false,
      isRoleAccount: false,
      mailRoutingStatus: "domain_not_found",
      status: "format_invalid",
      explanation: "Email violates RFC 5322 syntax specifications",
      checkedAt,
    };
  }

  const isRoleAccount = ROLE_PREFIXES.has(localPart.toLowerCase());

  // Check Domain Mail Routing via DNS
  let mailRoutingStatus: EmailValidationResult["mailRoutingStatus"] = "unknown";
  let status: EmailValidationStatus = "observed_only";
  let explanation = "Syntax valid; domain routing not yet checked.";

  const absent = (error: unknown) => ["ENOTFOUND", "ENODATA"].includes((error as { code?: string }).code ?? "");
  try {
    let mxRecords: Awaited<ReturnType<dns.Resolver["resolveMx"]>> = [];
    try {
      mxRecords = await resolver.resolveMx(domainPart);
    } catch (error) {
      if (!absent(error)) throw error;
    }
    if (mxRecords.some((mx) => mx.exchange === "." || mx.exchange === "")) {
      mailRoutingStatus = "null_mx_rejected";
      status = "domain_not_routable";
      explanation = "Domain advertises null MX. Mailbox delivery is not verified.";
    } else if (mxRecords.length) {
      mailRoutingStatus = "routable";
      status = "domain_routable";
      explanation = "Domain has MX routing. Mailbox delivery is not verified.";
    } else {
      const addresses = await Promise.allSettled([
        resolver.resolve4(domainPart), resolver.resolve6(domainPart),
      ]);
      if (addresses.some((result) => result.status === "fulfilled" && result.value.length > 0)) {
        mailRoutingStatus = "routable";
        status = "domain_routable";
        explanation = "Domain has A/AAAA fallback routing. Mailbox delivery is not verified.";
      } else if (addresses.some((result) => result.status === "rejected" && !absent(result.reason))) {
        status = "domain_unknown";
        explanation = "Transient address lookup failure; routing remains unknown.";
      } else {
        mailRoutingStatus = "domain_not_found";
        status = "domain_not_routable";
        explanation = "No MX or A/AAAA mail route found.";
      }
    }
  } catch {
    mailRoutingStatus = "unknown";
    status = "domain_unknown";
    explanation = "Transient DNS query failure; routing remains unknown.";
  }

  return {
    raw: trimmed,
    normalized,
    localPart,
    domain: domainPart,
    formatValid: true,
    isRoleAccount,
    mailRoutingStatus,
    status,
    explanation,
    checkedAt,
  };
}

/**
 * Validates and normalizes phone number with country context without claiming active number verification.
 */
export function validatePhone(rawPhone: string, countryContext?: string): PhoneValidationResult {
  const trimmed = rawPhone.trim();
  const checkedAt = new Date().toISOString();
  const digitsOnly = trimmed.replace(/\D/g, "");

  // Minimal sensible phone digits: 7 to 15 digits (ITU-T E.164 max 15 digits)
  if (digitsOnly.length < 7 || digitsOnly.length > 15 || !/^\+?[\d\s().-]+$/.test(trimmed) || (trimmed.startsWith("+") && digitsOnly.startsWith("0"))) {
    return {
      raw: trimmed,
      normalized: trimmed,
      digitsOnly,
      formatValid: false,
      status: "format_invalid",
      explanation: `Phone number has ${digitsOnly.length} digits; valid numbering plans require between 7 and 15 digits.`,
      checkedAt,
    };
  }

  // Preserve leading plus if international
  const hasLeadingPlus = trimmed.startsWith("+");
  const normalized = hasLeadingPlus ? `+${digitsOnly}` : digitsOnly;

  // Digit length alone is not numbering-plan validation. Until a maintained
  // numbering metadata library is integrated, report only possible format.
  const countryCode = countryContext && /^[A-Z]{2}$/.test(countryContext) ? countryContext : undefined;
  const status: PhoneValidationStatus = "numbering_plan_possible";
  const explanation = "Plausible digit length only; numbering plan and active status are unverified.";

  return {
    raw: trimmed,
    normalized,
    digitsOnly,
    countryCode,
    formatValid: true,
    status,
    explanation,
    checkedAt,
  };
}
