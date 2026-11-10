#!/usr/bin/env node
/**
 * CLI tool to probe a running SIP server using SIP OPTIONS ping.
 *
 * OPTIONS is safe because it never creates a call or bills minutes. Any SIP
 * response (even 4xx) proves that UDP/TCP signalling and firewall ports are open.
 *
 * Usage:
 *   node scripts/check-sip-stack.mjs <host> [--port 5060] [--transport udp|tcp] [--timeout 3000] [--expect-ips ip1,ip2]
 *
 * Examples:
 *   node scripts/check-sip-stack.mjs sip.example.com --port 5060 --transport udp
 *   node scripts/check-sip-stack.mjs 127.0.0.1 --port 5060 --transport tcp
 */
import dns from "node:dns/promises";
import process from "node:process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "services/voice-service/dist");

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    console.log(`
Usage:
  node scripts/check-sip-stack.mjs <host> [options]

Options:
  --port <port>          SIP port (default: 5060)
  --transport <udp|tcp>  Transport protocol (default: udp)
  --timeout <ms>         Probe timeout in milliseconds (default: 3000)
  --expect-ips <list>    Comma-separated expected public IPs for DNS check
  -h, --help             Show this help message
`);
    process.exit(args.length === 0 ? 1 : 0);
  }

  const host = args[0];
  let port = 5060;
  let transport = "udp";
  let timeoutMs = 3000;
  let expectIps = [];

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      port = Number(args[++i]);
    } else if (args[i] === "--transport" && args[i + 1]) {
      transport = args[++i].toLowerCase();
    } else if (args[i] === "--timeout" && args[i + 1]) {
      timeoutMs = Number(args[++i]);
    } else if (args[i] === "--expect-ips" && args[i + 1]) {
      expectIps = args[++i].split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  console.log(`\n🔍 Probing SIP edge at ${host}:${port} (${transport.toUpperCase()})...\n`);

  // 1. DNS Resolution check (if host is not an IP)
  let resolvedIps = [];
  try {
    const lookup = await dns.lookup(host, { all: true });
    resolvedIps = lookup.map((l) => l.address);
    console.log(`  DNS Resolution: ${host} -> [${resolvedIps.join(", ")}]`);
    if (expectIps.length > 0) {
      const match = expectIps.some((ip) => resolvedIps.includes(ip));
      if (match) {
        console.log(`  ✅ Matches expected IP list`);
      } else {
        console.warn(`  ⚠️ Warning: Resolved IP does not match expected list [${expectIps.join(", ")}]`);
      }
    }
  } catch {
    // If it's a raw IP or unresolvable locally
    resolvedIps = [host];
  }

  // 2. SIP OPTIONS Probe
  const { probeSipOptions } = await import(
    pathToFileURL(path.join(dist, "telephony/sip-probe.js")).href
  );

  const result = await probeSipOptions({
    host,
    port,
    transport,
    timeoutMs,
  });

  if (result.reachable) {
    console.log(`\n  ✅ SIP Edge is REACHABLE!`);
    console.log(`     Status:      ${result.statusCode} ${result.statusText}`);
    console.log(`     Latency:     ${result.latencyMs} ms`);
    if (result.server) console.log(`     Server:      ${result.server}`);
    if (result.allow) console.log(`     Allow:       ${result.allow}`);
    console.log();
    process.exit(0);
  } else {
    console.error(`\n  ❌ SIP Edge is UNREACHABLE`);
    console.error(`     Error:       ${result.error}`);
    console.error(`     Host:        ${host}:${port} (${transport})`);
    console.error(`\n  Troubleshooting checklist:`);
    console.error(`   - Is livekit/sip container running? (docker compose -f deploy/sip/docker-compose.yml ps)`);
    console.error(`   - Is port ${port}/${transport} open in your firewall/security group?`);
    console.error(`   - Is host networking active on the sip container?`);
    console.error();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Probe error:", err);
  process.exit(1);
});
