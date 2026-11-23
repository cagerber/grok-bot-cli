import assert from "node:assert/strict";
import test from "node:test";

process.env.GROK_BOT_ROUTE_RETRY_MS = "1,1,1";
const { connectGateway, listAgents } = await import("../src/core/gateway.js");

function withGatewayEnv(t) {
  const values = {
    GROK_BOT_TEST: "1",
    GROK_BOT_GATEWAY_URL: "http://127.0.0.1:1340",
    GROK_BOT_GATEWAY_TOKEN: "test-token",
  };
  for (const [name, value] of Object.entries(values)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
}

const unrouted = () => new Response("The request could not be routed", { status: 404 });
const roster = () => Response.json({ agents: [{ id: "one", name: "Research" }] });

test("read retries a transient 'could not be routed' 404 and then succeeds", async (t) => {
  withGatewayEnv(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => (++calls <= 2 ? unrouted() : roster()));
  const session = await connectGateway({});
  const agents = await listAgents(session);
  assert.equal(calls, 3);
  assert.equal(agents[0].name, "Research");
});

test("read gives up after the bounded number of retries", async (t) => {
  withGatewayEnv(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls += 1; return unrouted(); });
  const session = await connectGateway({});
  await assert.rejects(() => listAgents(session), /404.*computer may be asleep/s);
  assert.equal(calls, 4); // first try + 3 retries (test env sets 1,1,1)
});

test("a genuine 404 that is not a routing error is not retried", async (t) => {
  withGatewayEnv(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls += 1; return new Response("Not Found", { status: 404 }); });
  const session = await connectGateway({});
  await assert.rejects(() => listAgents(session), /404/);
  assert.equal(calls, 1);
});
