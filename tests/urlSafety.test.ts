import assert from "node:assert/strict";
import test from "node:test";

import {
  UrlSafetyError,
  readResponseTextCapped,
  safeFetchUrl,
  validateMonitorUrl,
  type DnsLookup,
} from "../src/utils/urlSafety.ts";

const publicLookup: DnsLookup = async () => [{ address: "93.184.216.34", family: 4 }];

async function assertUrlRejected(url: string, pattern: RegExp): Promise<void> {
  await assert.rejects(
    () => validateMonitorUrl(url, { lookup: publicLookup }),
    (error) => error instanceof UrlSafetyError && pattern.test(error.message)
  );
}

test("allows public http and https monitor URLs", async () => {
  await assert.doesNotReject(() => validateMonitorUrl("https://example.com/health", { lookup: publicLookup }));
  await assert.doesNotReject(() => validateMonitorUrl("http://example.com/status", { lookup: publicLookup }));
});

test("blocks localhost hostnames", async () => {
  await assertUrlRejected("http://localhost:3000", /localhost|internal|single-label/i);
  await assertUrlRejected("https://app.localhost", /internal|reserved/i);
});

test("blocks 127.0.0.1 loopback URLs", async () => {
  await assertUrlRejected("http://127.0.0.1:5000", /loopback/i);
  await assertUrlRejected("http://[::1]:5000", /loopback/i);
});

test("blocks 0.0.0.0 URLs", async () => {
  await assertUrlRejected("http://0.0.0.0:3000", /unspecified/i);
});

test("blocks private IPv4 ranges", async () => {
  await assertUrlRejected("http://10.0.0.5", /private/i);
  await assertUrlRejected("http://172.16.2.10", /private/i);
  await assertUrlRejected("http://192.168.1.20", /private/i);
});

test("blocks link-local metadata address", async () => {
  await assertUrlRejected("http://169.254.169.254/latest/meta-data", /link-local/i);
  await assertUrlRejected("http://[fe80::1]/", /link-local/i);
});

test("blocks invalid protocols", async () => {
  await assertUrlRejected("file:///etc/passwd", /http:\/\/ and https:\/\//i);
  await assertUrlRejected("ftp://example.com/file", /http:\/\/ and https:\/\//i);
});

test("blocks hostnames that resolve to private addresses", async () => {
  const privateLookup: DnsLookup = async () => [{ address: "192.168.0.10", family: 4 }];

  await assert.rejects(
    () => validateMonitorUrl("https://public-name.com", { lookup: privateLookup }),
    (error) => error instanceof UrlSafetyError && /resolves to a blocked address/i.test(error.message)
  );
});

test("validates every redirect hop before following it", async () => {
  const calls: string[] = [];
  const fetchImpl = async (url: string | URL | Request): Promise<Response> => {
    calls.push(String(url));
    return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/admin" },
    });
  };

  await assert.rejects(
    () =>
      safeFetchUrl("https://public.example.com/start", {
        lookup: publicLookup,
        fetchImpl,
      }),
    (error) => error instanceof UrlSafetyError && /loopback/i.test(error.message)
  );

  assert.deepEqual(calls, ["https://public.example.com/start"]);
});

test("safe fetch returns public responses and supports capped reads", async () => {
  const fetchImpl = async (): Promise<Response> => new Response("healthy", { status: 200 });
  const result = await safeFetchUrl("https://public.example.com/health", {
    lookup: publicLookup,
    fetchImpl,
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.finalUrl, "https://public.example.com/health");
  assert.equal(await readResponseTextCapped(result.response, 1024), "healthy");
});
