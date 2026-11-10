/** Client-side checks for the bring-your-own-SIP forms. The backend remains the source of truth. */

const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

/** Mirrors the backend limits: broad ranges would let large networks reach the trunk. */
export const MIN_IPV4_PREFIX = 16;
export const MIN_IPV6_PREFIX = 48;

export function isE164(value: string): boolean {
  return E164_PATTERN.test(value.trim());
}

function isIPv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isIPv6(value: string): boolean {
  if (!value.includes(":") || !/^[0-9a-fA-F:.]+$/.test(value)) return false;
  const doubleColon = value.split("::");
  if (doubleColon.length > 2) return false;
  let groupsBudget = 8;
  const groups: string[] = [];
  for (const side of doubleColon) {
    if (side !== "") groups.push(...side.split(":"));
  }
  if (groups.length === 0) return doubleColon.length === 2;
  const last = groups[groups.length - 1];
  if (last.includes(".")) {
    if (!isIPv4(last)) return false;
    groups.pop();
    groupsBudget -= 2;
  }
  if (!groups.every((group) => /^[0-9a-fA-F]{1,4}$/.test(group))) return false;
  return doubleColon.length === 2 ? groups.length < groupsBudget : groups.length === groupsBudget;
}

/** Returns an error message, or null when the entry looks like a valid IP or CIDR. */
export function validateAddress(entry: string): string | null {
  const [address, prefix, ...rest] = entry.split("/");
  if (rest.length > 0) return `"${entry}" is not a valid IP or CIDR.`;
  const v4 = isIPv4(address);
  const v6 = !v4 && isIPv6(address);
  if (!v4 && !v6) return `"${entry}" is not a valid IP or CIDR.`;
  if (prefix === undefined) return null;
  if (!/^\d{1,3}$/.test(prefix)) return `"${entry}" has an invalid prefix length.`;
  const bits = Number(prefix);
  if (v4) {
    if (bits > 32) return `"${entry}" has an invalid prefix length.`;
    if (bits < MIN_IPV4_PREFIX) return `"${entry}" is too broad (use /${MIN_IPV4_PREFIX} or narrower).`;
  } else {
    if (bits > 128) return `"${entry}" has an invalid prefix length.`;
    if (bits < MIN_IPV6_PREFIX) return `"${entry}" is too broad (use /${MIN_IPV6_PREFIX} or narrower).`;
  }
  return null;
}

/** Splits on newlines, commas and whitespace; trims and de-duplicates. */
export function parseAddressList(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of text.split(/[\s,;]+/)) {
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export function validateAddressList(entries: string[]): string | null {
  for (const entry of entries) {
    const error = validateAddress(entry);
    if (error) return error;
  }
  return null;
}
