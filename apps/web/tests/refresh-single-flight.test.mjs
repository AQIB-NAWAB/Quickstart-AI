import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshSingleFlight } from '../src/lib/server/auth/refresh-single-flight.ts';

test('parallel polling and cancel requests rotate a refresh token only once', async () => {
  let calls = 0;
  const token = 'test-session-' + crypto.randomUUID();
  const load = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 20)); return {access_token:'new-access',refresh_token:'new-refresh'}; };
  const results = await Promise.all(Array.from({length:20}, () => refreshSingleFlight(token,load)));
  assert.equal(calls,1);
  assert.ok(results.every(result => result.refresh_token === 'new-refresh'));
  await refreshSingleFlight(token,load);
  assert.equal(calls,1,'overlapping response requests must reuse the same rotated pair');
});

test('independent sessions never share refresh results and transport failures can retry', async () => {
  assert.notEqual(await refreshSingleFlight(crypto.randomUUID(),async()=> 'one'),await refreshSingleFlight(crypto.randomUUID(),async()=> 'two'));
  const token=crypto.randomUUID();
  await assert.rejects(()=>refreshSingleFlight(token,async()=>{throw new Error('network');}),/network/);
  assert.equal(await refreshSingleFlight(token,async()=> 'recovered'),'recovered');
});
