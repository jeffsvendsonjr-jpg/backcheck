import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MAX_RESPONSE_BYTES,
  UrlSafetyError,
  getBlockedIpReason,
  isUrlSafetyError,
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

// ============================================================================
// UrlSafetyError — constructor, properties
// ============================================================================

test("UrlSafetyError sets name, code, message, and url", () => {
  const err = new UrlSafetyError("URL_INVALID", "bad url", "http://bad");
  assert.equal(err.name, "UrlSafetyError");
  assert.equal(err.code, "URL_INVALID");
  assert.equal(err.message, "bad url");
  assert.equal(err.url, "http://bad");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof UrlSafetyError);
});

test("UrlSafetyError url defaults to null when omitted", () => {
  const err = new UrlSafetyError("RESPONSE_TOO_LARGE", "too big");
  assert.equal(err.url, null);
});

test("UrlSafetyError url is null when explicitly passed null", () => {
  const err = new UrlSafetyError("URL_TIMEOUT", "timed out", null);
  assert.equal(err.url, null);
});

// ============================================================================
// isUrlSafetyError()
// ============================================================================

test("isUrlSafetyError returns true for UrlSafetyError instances", () => {
  const err = new UrlSafetyError("URL_HOST_BLOCKED", "blocked");
  assert.equal(isUrlSafetyError(err), true);
});

test("isUrlSafetyError returns false for plain Error", () => {
  assert.equal(isUrlSafetyError(new Error("regular")), false);
});

test("isUrlSafetyError returns false for null, undefined, string", () => {
  assert.equal(isUrlSafetyError(null), false);
  assert.equal(isUrlSafetyError(undefined), false);
  assert.equal(isUrlSafetyError("URL_INVALID"), false);
});

// ============================================================================
// DEFAULT_MAX_RESPONSE_BYTES constant
// ============================================================================

test("DEFAULT_MAX_RESPONSE_BYTES is 1 MiB", () => {
  assert.equal(DEFAULT_MAX_RESPONSE_BYTES, 1024 * 1024);
});

// ============================================================================
// getBlockedIpReason() — IPv4
// ============================================================================

test("getBlockedIpReason returns null for public IPv4 addresses", () => {
  assert.equal(getBlockedIpReason("8.8.8.8"), null);
  assert.equal(getBlockedIpReason("93.184.216.34"), null);
  assert.equal(getBlockedIpReason("1.1.1.1"), null);
});

test("getBlockedIpReason identifies loopback IPv4 range", () => {
  assert.match(getBlockedIpReason("127.0.0.1")!, /loopback/i);
  assert.match(getBlockedIpReason("127.255.255.255")!, /loopback/i);
});

test("getBlockedIpReason identifies unspecified 0.0.0.0 range", () => {
  assert.match(getBlockedIpReason("0.0.0.0")!, /unspecified/i);
  assert.match(getBlockedIpReason("0.255.0.1")!, /unspecified/i);
});

test("getBlockedIpReason identifies private IPv4 ranges", () => {
  assert.match(getBlockedIpReason("10.0.0.1")!, /private/i);
  assert.match(getBlockedIpReason("10.255.255.255")!, /private/i);
  assert.match(getBlockedIpReason("172.16.0.1")!, /private/i);
  assert.match(getBlockedIpReason("172.31.255.255")!, /private/i);
  assert.match(getBlockedIpReason("192.168.0.1")!, /private/i);
  assert.match(getBlockedIpReason("192.168.255.255")!, /private/i);
});

test("getBlockedIpReason identifies link-local IPv4 range", () => {
  assert.match(getBlockedIpReason("169.254.0.1")!, /link-local/i);
  assert.match(getBlockedIpReason("169.254.169.254")!, /link-local/i);
});

test("getBlockedIpReason identifies carrier-grade NAT range (100.64.0.0/10)", () => {
  assert.match(getBlockedIpReason("100.64.0.1")!, /carrier-grade/i);
  assert.match(getBlockedIpReason("100.127.255.255")!, /carrier-grade/i);
});

test("getBlockedIpReason identifies documentation IPv4 ranges", () => {
  assert.match(getBlockedIpReason("192.0.2.1")!, /documentation/i);
  assert.match(getBlockedIpReason("198.51.100.1")!, /documentation/i);
  assert.match(getBlockedIpReason("203.0.113.1")!, /documentation/i);
});

test("getBlockedIpReason identifies benchmark IPv4 range (198.18.0.0/15)", () => {
  assert.match(getBlockedIpReason("198.18.0.1")!, /benchmark/i);
  assert.match(getBlockedIpReason("198.19.255.255")!, /benchmark/i);
});

test("getBlockedIpReason identifies multicast IPv4 range (224.0.0.0/4)", () => {
  assert.match(getBlockedIpReason("224.0.0.1")!, /multicast/i);
  assert.match(getBlockedIpReason("239.255.255.255")!, /multicast/i);
});

test("getBlockedIpReason identifies reserved IPv4 range (240.0.0.0/4)", () => {
  assert.match(getBlockedIpReason("240.0.0.1")!, /reserved/i);
  assert.match(getBlockedIpReason("255.255.255.255")!, /reserved/i);
});

// ============================================================================
// getBlockedIpReason() — IPv6
// ============================================================================

test("getBlockedIpReason identifies loopback IPv6 ::1 and ::", () => {
  assert.match(getBlockedIpReason("::1")!, /loopback/i);
  assert.match(getBlockedIpReason("::")!, /loopback|unspecified/i);
});

test("getBlockedIpReason identifies IPv4-mapped IPv6 addresses", () => {
  assert.match(getBlockedIpReason("::ffff:192.168.0.1")!, /IPv4-mapped/i);
  assert.match(getBlockedIpReason("::ffff:10.0.0.1")!, /IPv4-mapped/i);
});

test("getBlockedIpReason identifies 6to4 IPv6 transition range (2002::/16)", () => {
  assert.match(getBlockedIpReason("2002:c0a8:0101::1")!, /6to4/i);
});

test("getBlockedIpReason identifies Teredo IPv6 range (2001::/32)", () => {
  assert.match(getBlockedIpReason("2001:0:c000:0204::")!, /teredo/i);
});

test("getBlockedIpReason identifies link-local IPv6 range (fe80::/10)", () => {
  assert.match(getBlockedIpReason("fe80::1")!, /link-local/i);
  assert.match(getBlockedIpReason("febf::1")!, /link-local/i);
});

test("getBlockedIpReason identifies unique-local IPv6 range (fc00::/7)", () => {
  assert.match(getBlockedIpReason("fc00::1")!, /unique-local/i);
  assert.match(getBlockedIpReason("fd12:3456::1")!, /unique-local/i);
});

test("getBlockedIpReason identifies multicast IPv6 range (ff00::/8)", () => {
  assert.match(getBlockedIpReason("ff02::1")!, /multicast/i);
});

test("getBlockedIpReason identifies documentation IPv6 range (2001:db8::/32)", () => {
  assert.match(getBlockedIpReason("2001:db8::1")!, /documentation/i);
});

test("getBlockedIpReason returns null for public IPv6 addresses", () => {
  assert.equal(getBlockedIpReason("2606:4700:4700::1111"), null);
  assert.equal(getBlockedIpReason("2001:4860:4860::8888"), null);
});

test("getBlockedIpReason returns null for non-IP strings", () => {
  assert.equal(getBlockedIpReason("example.com"), null);
  assert.equal(getBlockedIpReason("not-an-ip"), null);
});

// ============================================================================
// validateMonitorUrl() — additional edge cases
// ============================================================================

test("validateMonitorUrl rejects totally invalid URL strings", async () => {
  await assert.rejects(
    () => validateMonitorUrl("not a url at all", { lookup: publicLookup }),
    (error) => error instanceof UrlSafetyError && error.code === "URL_INVALID"
  );
  await assert.rejects(
    () => validateMonitorUrl("", { lookup: publicLookup }),
    (error) => error instanceof UrlSafetyError && error.code === "URL_INVALID"
  );
});

test("validateMonitorUrl rejects single-label hostnames", async () => {
  await assert.rejects(
    () => validateMonitorUrl("http://myserver/path", { lookup: publicLookup }),
    (error) =>
      error instanceof UrlSafetyError &&
      error.code === "URL_HOST_BLOCKED" &&
      /single-label/i.test(error.message)
  );
});

test("validateMonitorUrl rejects .local hostnames", async () => {
  await assert.rejects(
    () => validateMonitorUrl("http://myapp.local/", { lookup: publicLookup }),
    (error) => error instanceof UrlSafetyError && error.code === "URL_HOST_BLOCKED"
  );
});

test("validateMonitorUrl rejects .internal hostnames", async () => {
  await assert.rejects(
    () => validateMonitorUrl("https://service.internal/health", { lookup: publicLookup }),
    (error) => error instanceof UrlSafetyError && error.code === "URL_HOST_BLOCKED"
  );
});

test("validateMonitorUrl rejects .corp hostnames", async () => {
  await assert.rejects(
    () => validateMonitorUrl("https://app.corp/api", { lookup: publicLookup }),
    (error) => error instanceof UrlSafetyError && error.code === "URL_HOST_BLOCKED"
  );
});

test("validateMonitorUrl rejects .svc hostnames (Kubernetes service DNS)", async () => {
  await assert.rejects(
    () => validateMonitorUrl("http://svc.cluster.local/", { lookup: publicLookup }),
    (error) => error instanceof UrlSafetyError && error.code === "URL_HOST_BLOCKED"
  );
});

test("validateMonitorUrl rejects 'metadata' hostname", async () => {
  await assert.rejects(
    () => validateMonitorUrl("http://metadata/latest/meta-data", { lookup: publicLookup }),
    (error) => error instanceof UrlSafetyError && error.code === "URL_HOST_BLOCKED"
  );
});

test("validateMonitorUrl rejects metadata.google.internal", async () => {
  await assert.rejects(
    () => validateMonitorUrl("http://metadata.google.internal/", { lookup: publicLookup }),
    (error) => error instanceof UrlSafetyError && error.code === "URL_HOST_BLOCKED"
  );
});

test("validateMonitorUrl rejects hostnames with IPv6 zone identifiers", async () => {
  // Some environments reject the zone-ID URL at parse time (URL_INVALID) while
  // others normalise it and reject at host-validation time (URL_HOST_BLOCKED).
  // Both outcomes represent a correct security rejection.
  await assert.rejects(
    () => validateMonitorUrl("http://[fe80::1%25eth0]/", { lookup: publicLookup }),
    (error) =>
      error instanceof UrlSafetyError &&
      (error.code === "URL_HOST_BLOCKED" || error.code === "URL_INVALID")
  );
});

test("validateMonitorUrl rejects when DNS lookup throws", async () => {
  const failingLookup: DnsLookup = async () => {
    throw new Error("ENOTFOUND");
  };
  await assert.rejects(
    () => validateMonitorUrl("https://nonexistent.example.com", { lookup: failingLookup }),
    (error) =>
      error instanceof UrlSafetyError &&
      error.code === "URL_DNS_LOOKUP_FAILED" &&
      /could not be resolved/i.test(error.message)
  );
});

test("validateMonitorUrl rejects when DNS returns empty array", async () => {
  const emptyLookup: DnsLookup = async () => [];
  await assert.rejects(
    () => validateMonitorUrl("https://example.com", { lookup: emptyLookup }),
    (error) =>
      error instanceof UrlSafetyError &&
      error.code === "URL_DNS_LOOKUP_FAILED" &&
      /did not resolve to an address/i.test(error.message)
  );
});

test("validateMonitorUrl returns correct ValidatedMonitorUrl shape", async () => {
  const result = await validateMonitorUrl("https://example.com/path?q=1", { lookup: publicLookup });
  assert.equal(typeof result.url, "string");
  assert.equal(typeof result.hostname, "string");
  assert.ok(Array.isArray(result.addresses));
  assert.ok(result.addresses.length > 0);
  assert.equal(result.hostname, "example.com");
  assert.ok(result.url.startsWith("https://example.com"));
});

test("validateMonitorUrl rejects carrier-grade NAT addresses directly", async () => {
  await assert.rejects(
    () => validateMonitorUrl("http://100.64.0.1/", { lookup: publicLookup }),
    (error) =>
      error instanceof UrlSafetyError &&
      error.code === "URL_HOST_BLOCKED" &&
      /carrier-grade/i.test(error.message)
  );
});

test("validateMonitorUrl rejects hostnames resolving to carrier-grade NAT", async () => {
  const cgnLookup: DnsLookup = async () => [{ address: "100.64.5.10", family: 4 }];
  await assert.rejects(
    () => validateMonitorUrl("https://example.com", { lookup: cgnLookup }),
    (error) =>
      error instanceof UrlSafetyError &&
      error.code === "URL_ADDRESS_BLOCKED" &&
      /resolves to a blocked address/i.test(error.message)
  );
});

test("validateMonitorUrl includes the hostname in the error url field", async () => {
  await assert.rejects(
    () => validateMonitorUrl("http://127.0.0.1/"),
    (error) =>
      error instanceof UrlSafetyError &&
      error.url !== null
  );
});

// ============================================================================
// safeFetchUrl() — additional edge cases
// ============================================================================

test("safeFetchUrl throws URL_TIMEOUT when fetch AbortError occurs", async () => {
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal as AbortSignal | undefined;
    if (signal) {
      await new Promise<void>((_, reject) => {
        signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted.");
          err.name = "AbortError";
          reject(err);
        });
      });
    }
    return new Response("ok", { status: 200 });
  };

  await assert.rejects(
    () =>
      safeFetchUrl("https://public.example.com/slow", {
        lookup: publicLookup,
        fetchImpl,
        timeoutMs: 10,
      }),
    (error) => error instanceof UrlSafetyError && error.code === "URL_TIMEOUT"
  );
});

test("safeFetchUrl propagates non-AbortError fetch errors", async () => {
  const networkError = new Error("network failure");
  const fetchImpl = async (): Promise<Response> => {
    throw networkError;
  };

  await assert.rejects(
    () =>
      safeFetchUrl("https://public.example.com/", {
        lookup: publicLookup,
        fetchImpl,
      }),
    (error) => error === networkError
  );
});

test("safeFetchUrl follows 301/302/303/307/308 redirects", async () => {
  const redirectStatuses = [301, 302, 303, 307, 308];

  for (const status of redirectStatuses) {
    let callCount = 0;
    const fetchImpl = async (): Promise<Response> => {
      callCount++;
      if (callCount === 1) {
        return new Response(null, {
          status,
          headers: { location: "https://public.example.com/final" },
        });
      }
      return new Response("final", { status: 200 });
    };

    const result = await safeFetchUrl("https://public.example.com/start", {
      lookup: publicLookup,
      fetchImpl,
    });

    assert.equal(result.response.status, 200, `Expected 200 after ${status} redirect`);
    assert.equal(result.finalUrl, "https://public.example.com/final");
    assert.equal(callCount, 2, `Expected 2 fetch calls for ${status} redirect`);
  }
});

test("safeFetchUrl tracks redirect chain", async () => {
  let callCount = 0;
  const fetchImpl = async (): Promise<Response> => {
    callCount++;
    if (callCount === 1) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://public.example.com/step2" },
      });
    }
    if (callCount === 2) {
      return new Response(null, {
        status: 301,
        headers: { location: "https://public.example.com/final" },
      });
    }
    return new Response("done", { status: 200 });
  };

  const result = await safeFetchUrl("https://public.example.com/start", {
    lookup: publicLookup,
    fetchImpl,
  });

  assert.deepEqual(result.redirectChain, [
    "https://public.example.com/step2",
    "https://public.example.com/final",
  ]);
  assert.equal(result.finalUrl, "https://public.example.com/final");
});

test("safeFetchUrl returns redirect response when no location header is present", async () => {
  const fetchImpl = async (): Promise<Response> =>
    new Response(null, { status: 302 });

  const result = await safeFetchUrl("https://public.example.com/", {
    lookup: publicLookup,
    fetchImpl,
  });

  assert.equal(result.response.status, 302);
  assert.equal(result.finalUrl, "https://public.example.com/");
  assert.deepEqual(result.redirectChain, []);
});

test("safeFetchUrl throws URL_TOO_MANY_REDIRECTS when maxRedirects is 0 and redirect is returned", async () => {
  const fetchImpl = async (): Promise<Response> =>
    new Response(null, {
      status: 302,
      headers: { location: "https://public.example.com/other" },
    });

  await assert.rejects(
    () =>
      safeFetchUrl("https://public.example.com/start", {
        lookup: publicLookup,
        fetchImpl,
        maxRedirects: 0,
      }),
    (error) =>
      error instanceof UrlSafetyError &&
      error.code === "URL_TOO_MANY_REDIRECTS" &&
      /redirect limit exceeded/i.test(error.message)
  );
});

test("safeFetchUrl blocks redirect to a non-http/https protocol", async () => {
  // A redirect to a javascript: or data: URL will be parsed successfully by
  // the URL constructor but will be rejected by validateMonitorUrl because the
  // protocol is not http or https.
  const fetchImpl = async (): Promise<Response> =>
    new Response(null, {
      status: 302,
      headers: { location: "javascript:alert(1)" },
    });

  await assert.rejects(
    () =>
      safeFetchUrl("https://public.example.com/start", {
        lookup: publicLookup,
        fetchImpl,
      }),
    (error) =>
      error instanceof UrlSafetyError &&
      error.code === "URL_PROTOCOL_BLOCKED"
  );
});

test("safeFetchUrl throws URL_HOST_BLOCKED when redirect goes to blocked host", async () => {
  const fetchImpl = async (url: string | URL | Request): Promise<Response> => {
    const urlStr = String(url);
    if (urlStr.includes("/start")) {
      return new Response(null, {
        status: 302,
        headers: { location: "http://10.0.0.1/secret" },
      });
    }
    return new Response("ok", { status: 200 });
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
      /private/i.test(error.message)
  );
});

test("safeFetchUrl responseTimeMs is a non-negative number", async () => {
  const fetchImpl = async (): Promise<Response> => new Response("ok", { status: 200 });
  const result = await safeFetchUrl("https://public.example.com/", {
    lookup: publicLookup,
    fetchImpl,
  });

  assert.equal(typeof result.responseTimeMs, "number");
  assert.ok(result.responseTimeMs >= 0);
});

test("safeFetchUrl passes custom method and headers to fetch", async () => {
  let capturedMethod: string | undefined;
  let capturedHeaders: HeadersInit | undefined;

  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capturedMethod = init?.method;
    capturedHeaders = init?.headers;
    return new Response(null, { status: 204 });
  };

  await safeFetchUrl("https://public.example.com/api", {
    lookup: publicLookup,
    fetchImpl,
    method: "HEAD",
    headers: { "X-Custom": "test-value" },
  });

  assert.equal(capturedMethod, "HEAD");
  assert.ok(capturedHeaders !== undefined);
  const headersObj = new Headers(capturedHeaders as HeadersInit);
  assert.equal(headersObj.get("x-custom"), "test-value");
});

// ============================================================================
// readResponseTextCapped() — additional edge cases
// ============================================================================

test("readResponseTextCapped returns empty string for response with no body", async () => {
  const response = new Response(null, { status: 204 });
  const result = await readResponseTextCapped(response, 1024);
  assert.equal(result, "");
});

test("readResponseTextCapped returns correct decoded text", async () => {
  const response = new Response("hello world", { status: 200 });
  const result = await readResponseTextCapped(response, 1024);
  assert.equal(result, "hello world");
});

test("readResponseTextCapped allows exactly maxBytes without throwing", async () => {
  const body = "a".repeat(8);
  const response = new Response(body, { status: 200 });
  const result = await readResponseTextCapped(response, 8);
  assert.equal(result, body);
});

test("readResponseTextCapped uses DEFAULT_MAX_RESPONSE_BYTES when no limit given", async () => {
  // A response well under the limit should succeed
  const response = new Response("small body", { status: 200 });
  const result = await readResponseTextCapped(response);
  assert.equal(result, "small body");
});

test("readResponseTextCapped correctly decodes multi-byte UTF-8 characters", async () => {
  const text = "héllo wörld — こんにちは";
  const response = new Response(text, { status: 200 });
  const result = await readResponseTextCapped(response, 1024);
  assert.equal(result, text);
});
