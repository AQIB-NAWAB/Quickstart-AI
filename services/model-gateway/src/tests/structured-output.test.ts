import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { withModelGatewayServer, authHeaders } from "../helpers/test-app.js";

test("JSON mode, reasoning control and output allowance reach the compatible provider", async () => {
  const upstream = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.deepEqual(body.response_format,{type:"json_object"});
    assert.equal(body.reasoning_effort,"low");
    assert.equal(body.max_tokens,6000);
    res.setHeader("content-type","application/json");
    res.end(JSON.stringify({choices:[{message:{content:'{"ok":true}'},finish_reason:"length"}],usage:{prompt_tokens:20,completion_tokens:10}}));
  });
  await new Promise<void>(resolve=>upstream.listen(0,"127.0.0.1",resolve));
  try {
    await withModelGatewayServer(async ({baseUrl}) => {
      const response=await fetch(baseUrl+"/internal/complete",{method:"POST",headers:authHeaders(),body:JSON.stringify({workspace_id:"ws-1",request_id:"structured",model:{profile:"gemini",model_id:"gemini-3.5-flash"},messages:[{role:"user",content:"Return JSON"}],response_format:{type:"json_object"},reasoning_effort:"low",max_tokens:6000})});
      assert.equal(response.status,200);
      const body=await response.json() as {finish_reason:string};
      assert.equal(body.finish_reason,"length","Gateway must preserve truncation information");
    },{providerProfiles:[{id:"gemini",driver:"openai_compatible",baseUrl:`http://127.0.0.1:${(upstream.address() as {port:number}).port}`,apiKey:"test-key"}]});
  } finally { await new Promise<void>(resolve=>upstream.close(()=>resolve())); }
});
