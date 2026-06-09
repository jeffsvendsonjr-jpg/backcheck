import assert from "node:assert/strict";
import test from "node:test";

import {
  UrlSafetyError,
  readResponseTextCapped,
  safeFetchUrl,
  validateMonitorUrl,
  type DnsLookup,
  type UrlSafetyErrorCode,
} from "../src/utils/urlSafety.ts";

const publicLookup: DnsLookup = async () => [{ address: "93.184.216.34", family: 4 }];

async function assertUrlRejected(url: string, expectedCode: UrlSafetyErrorCode, pattern: RegExp): Promise<void> {
  await assert.rejects(
    () => validateMonitorUrl(url, { lookup: publicLookup }),
    (error) => error instanceof UrlSafetyError && error.code === expectedCode && pattern.test(error.message)
  );
}

test("allows public http and https monitor URLs", async () => {
  await assert.doesNotReject(() => validateMonitorUrl("https://example.com/health", { lookup: publicLookup }));
  await assert.doesNotReject(() => validateMonitorUrl("http://example.com/status", { lookup: publicLookup }));
});

test("blocks localhost hostnames", async () => {
  await assertUrlRejected("http://localhost:3000", "URL_HOST_BLOCKED", /localhost|internal|single-label/i);
  await assertUrlRejected("https://app.localhost", "URL_HOST_BLOCKED", /internal|reserved/i);
});

test("blocks 127.0.0.1 loopback URLs", async () => {
  await assertUrlRejected("http://127.0.0.1:5000", "URL_HOST_BLOCKED", /loopback/i);
  await assertUrlRejected("http://[::1]:5000", "URL_HOST_BLOCKED", /loopback/i);
});

test("blocks 0.0.0.0 URLs", async () => {
  await assertUrlRejected("http://0.0.0.0:3000", "URL_HOST_BLOCKED", /unspecified/i);
});

test("blocks private IPv4 ranges", async () => {
  await assertUrlRejected("http://10.0.0.5", "URL_HOST_BLOCKED", /private/i);
  await assertUrlRejected("http://172.16.2.10", "URL_HOST_BLOCKED", /private/i);
  await assertUrlRejected("http://192.168.1.20", "URL_HOST_BLOCKED", /private/i);
});

test("blocks link-local metadata address", async () => {
  await assertUrlRejected("http://169.254.169.254/latest/meta-data", "URL_HOST_BLOCKED", /link-local/i);
  await assertUrlRejected("http://[fe80::1]/", "URL_HOST_BLOCKED", /link-local/i);
});

test("blocks IPv6 transition mechanism addresses", async () => {
  await assertUrlRejected("http://[2002:c0a8:0101::1]/", "URL_HOST_BLOCKED", /6to4/i);
  await assertUrlRejected("http://[2001:0:c000:0204::]/", "URL_HOST_BLOCKED", /teredo/i);
});

test("blocks invalid protocols", async () => {
  await assertUrlRejected("file:///etc/passwd", "URL_PROTOCOL_BLOCKED", /http:\/\/ and https:\/\//i);
  await assertUrlRejected("ftp://example.com/file", "URL_PROTOCOL_BLOCKED", /http:\/\/ and https:\/\//i);
});

test("blocks hostnames that resolve to private addresses", async () => {
  const privateLookup: DnsLookup = async () => [{ address: "192.168.0.10", family: 4 }];

  await assert.rejects(
    () => validateMonitorUrl("https://public-name.com", { lookup: privateLookup }),
    (error) =>
      error instanceof UrlSafetyError &&
      error.code === "URL_ADDRESS_BLOCKED" &&
      /resolves to a blocked address/i.test(error.message)
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
    (error) =>
      error instanceof UrlSafetyError &&
      error.code === "URL_HOST_BLOCKED" &&
      /loopback/i.test(error.message)
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

test("readResponseTextCapped rejects responses larger than cap", async () => {
  const response = new Response("x".repeat(20), { status: 200 });

  await assert.rejects(
    () => readResponseTextCapped(response, 8),
    (error) => error instanceof UrlSafetyError && error.code === "RESPONSE_TOO_LARGE"
  );
});
