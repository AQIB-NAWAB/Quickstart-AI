import https from "node:https";
import { lookup } from "node:dns/promises";
import { assertPublicUrl, publicAddress } from "@quickstart/utilities";

/** Validate and pin DNS; never follow redirects carrying customer payloads/secrets. */
export async function requestPublicWebhook(raw: string, init: RequestInit): Promise<Response> {
  const url = await assertPublicUrl(raw);
  if (url.protocol !== "https:") throw new Error("WEBHOOK_CONFIG_ERROR: HTTPS required");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => !publicAddress(item.address)))
    throw new Error("UNSAFE_URL");
  const payload = typeof init.body === "string" ? init.body : "";
  if (Buffer.byteLength(payload) > 512 * 1024) throw new Error("WEBHOOK_PAYLOAD_TOO_LARGE");
  return new Promise<Response>((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: init.method ?? "POST",
        headers: Object.fromEntries(new Headers(init.headers)),
        signal: init.signal ?? AbortSignal.timeout(15000),
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1024 * 1024) {
            response.destroy(new Error("WEBHOOK_RESPONSE_TOO_LARGE"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          const status = response.statusCode ?? 502;
          // Response prohibits bodies for these statuses.
          resolve(
            new Response(
              [204, 205, 304].includes(status) ? null : Buffer.concat(chunks).toString("utf8"),
              { status },
            ),
          );
        });
      },
    );
    request.on("error", reject);
    request.end(payload);
  });
}
