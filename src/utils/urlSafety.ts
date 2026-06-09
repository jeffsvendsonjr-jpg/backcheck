import { lookup as dnsLookup } from "node:dns/promises";
import * as net from "node:net";

export type UrlSafetyErrorCode =
  | "URL_INVALID"
  | "URL_PROTOCOL_BLOCKED"
  | "URL_HOST_BLOCKED"
  | "URL_ADDRESS_BLOCKED"
  | "URL_DNS_LOOKUP_FAILED"
  | "URL_REDIRECT_BLOCKED"
  | "URL_TOO_MANY_REDIRECTS"
  | "URL_TIMEOUT"
  | "RESPONSE_TOO_LARGE";

export class UrlSafetyError extends Error {
  code: UrlSafetyErrorCode;
  url: string | null;

  constructor(code: UrlSafetyErrorCode, message: string, url?: string | null) {
    super(message);
    this.name = "UrlSafetyError";
    this.code = code;
    this.url = url ?? null;
  }
}

export function isUrlSafetyError(error: unknown): error is UrlSafetyError {
  return error instanceof UrlSafetyError;
}

export interface ResolvedAddress {
  address: string;
  family?: number;
}

export type DnsLookup = (hostname: string) => Promise<ResolvedAddress[]>;

export interface UrlSafetyOptions {
  lookup?: DnsLookup;
}

export interface SafeFetchOptions extends UrlSafetyOptions {
  fetchImpl?: typeof fetch;
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  timeoutMs?: number;
  maxRedirects?: number;
}

export interface SafeFetchResult {
  response: Response;
  finalUrl: string;
  redirectChain: string[];
  responseTimeMs: number;
}

export interface ValidatedMonitorUrl {
  url: string;
  hostname: string;
  addresses: string[];
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 5;
export const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".home.arpa",
  ".corp",
  ".test",
  ".invalid",
  ".example",
  ".svc",
  ".cluster.local",
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "169.254.169.254.xip.io",
  "169.254.169.254.nip.io",
]);

const BLOCKED_IPV4_CIDRS: Array<[string, number, string]> = [
  ["0.0.0.0", 8, "unspecified IPv4 range"],
  ["10.0.0.0", 8, "private IPv4 range"],
  ["100.64.0.0", 10, "carrier-grade NAT range"],
  ["127.0.0.0", 8, "loopback IPv4 range"],
  ["169.254.0.0", 16, "link-local IPv4 range"],
  ["172.16.0.0", 12, "private IPv4 range"],
  ["192.0.0.0", 24, "reserved IPv4 range"],
  ["192.0.2.0", 24, "documentation IPv4 range"],
  ["192.88.99.0", 24, "reserved IPv4 range"],
  ["192.168.0.0", 16, "private IPv4 range"],
  ["198.18.0.0", 15, "benchmark IPv4 range"],
  ["198.51.100.0", 24, "documentation IPv4 range"],
  ["203.0.113.0", 24, "documentation IPv4 range"],
  ["224.0.0.0", 4, "multicast IPv4 range"],
  ["240.0.0.0", 4, "reserved IPv4 range"],
];

function parseUrl(input: string): URL {
  try {
    return new URL(input.trim());
  } catch {
    throw new UrlSafetyError("URL_INVALID", `URL rejected: invalid URL "${input}".`);
  }
}

function normalizeHostname(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  while (host.endsWith(".")) {
    host = host.slice(0, -1);
  }
  return host;
}

function ipv4ToNumber(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }

  return value >>> 0;
}

function isIpv4InCidr(address: string, base: string, prefix: number): boolean {
  const addressNumber = ipv4ToNumber(address);
  const baseNumber = ipv4ToNumber(base);
  if (addressNumber === null || baseNumber === null) return false;

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return ((addressNumber & mask) >>> 0) === ((baseNumber & mask) >>> 0);
}

export function getBlockedIpReason(address: string): string | null {
  const normalized = normalizeHostname(address);
  const family = net.isIP(normalized);

  if (family === 4) {
    for (const [base, prefix, reason] of BLOCKED_IPV4_CIDRS) {
      if (isIpv4InCidr(normalized, base, prefix)) return reason;
    }
    return null;
  }

  if (family === 6) {
    if (normalized === "::" || normalized === "::1") return "loopback or unspecified IPv6 address";
    if (normalized.startsWith("::ffff:")) return "IPv4-mapped IPv6 address";
    if (/^2002:/i.test(normalized)) return "6to4 IPv6 transition range";
    if (/^2001:(?:0:|:)/i.test(normalized)) return "Teredo IPv6 transition range";
    if (/^fe[89ab][0-9a-f]:/i.test(normalized)) return "link-local IPv6 range";
    if (/^f[cd]/i.test(normalized)) return "unique-local IPv6 range";
    if (/^ff/i.test(normalized)) return "multicast IPv6 range";
    if (/^2001:db8:/i.test(normalized)) return "documentation IPv6 range";
  }

  return null;
}

function getBlockedHostnameReason(hostname: string): string | null {
  const host = normalizeHostname(hostname);

  if (!host) return "missing hostname";
  if (host.includes("%")) return "IPv6 zone identifiers are not allowed";
  if (net.isIP(host)) return getBlockedIpReason(host);
  if (BLOCKED_HOSTNAMES.has(host)) return "internal hostname";
  if (!host.includes(".")) return "single-label hostnames are treated as internal";

  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (host.endsWith(suffix)) return "internal or reserved hostname";
  }

  return null;
}

async function defaultLookup(hostname: string): Promise<ResolvedAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: false });
}

async function resolveAndValidateHost(hostname: string, options: UrlSafetyOptions = {}): Promise<string[]> {
  const host = normalizeHostname(hostname);
  const hostReason = getBlockedHostnameReason(host);

  if (hostReason) {
    throw new UrlSafetyError(
      "URL_HOST_BLOCKED",
      `URL rejected: ${hostReason} (${host}). Use a public deployment URL.`,
      host
    );
  }

  if (net.isIP(host)) {
    return [host];
  }

  const lookup = options.lookup ?? defaultLookup;
  let addresses: ResolvedAddress[];

  try {
    addresses = await lookup(host);
  } catch {
    throw new UrlSafetyError(
      "URL_DNS_LOOKUP_FAILED",
      `URL rejected: hostname could not be resolved by DNS (${host}).`,
      host
    );
  }

  if (addresses.length === 0) {
    throw new UrlSafetyError(
      "URL_DNS_LOOKUP_FAILED",
      `URL rejected: hostname did not resolve to an address (${host}).`,
      host
    );
  }

  const resolved = addresses.map((entry) => entry.address);
  for (const address of resolved) {
    const reason = getBlockedIpReason(address);
    if (reason) {
      throw new UrlSafetyError(
        "URL_ADDRESS_BLOCKED",
        `URL rejected: ${host} resolves to a blocked address (${address}, ${reason}). Use a public deployment URL.`,
        host
      );
    }
  }

  return resolved;
}

export async function validateMonitorUrl(input: string, options: UrlSafetyOptions = {}): Promise<ValidatedMonitorUrl> {
  const parsed = parseUrl(input);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UrlSafetyError(
      "URL_PROTOCOL_BLOCKED",
      "URL rejected: only http:// and https:// URLs are allowed.",
      parsed.toString()
    );
  }

  const hostname = normalizeHostname(parsed.hostname);
  const addresses = await resolveAndValidateHost(hostname, options);
  return { url: parsed.toString(), hostname, addresses };
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export async function safeFetchUrl(input: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const redirectChain: string[] = [];
  const startedAt = Date.now();
  let currentUrl = parseUrl(input);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    await validateMonitorUrl(currentUrl.toString(), options);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;

    try {
      response = await fetchImpl(currentUrl.toString(), {
        method: options.method ?? "GET",
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
        redirect: "manual",
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new UrlSafetyError(
          "URL_TIMEOUT",
          `URL timed out after ${timeoutMs}ms: ${currentUrl.toString()}`,
          currentUrl.toString()
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!isRedirectStatus(response.status)) {
      return {
        response,
        finalUrl: currentUrl.toString(),
        redirectChain,
        responseTimeMs: Date.now() - startedAt,
      };
    }

    const location = response.headers.get("location");
    if (!location) {
      return {
        response,
        finalUrl: currentUrl.toString(),
        redirectChain,
        responseTimeMs: Date.now() - startedAt,
      };
    }

    if (redirectCount === maxRedirects) {
      throw new UrlSafetyError(
        "URL_TOO_MANY_REDIRECTS",
        `URL rejected: redirect limit exceeded (${maxRedirects}).`,
        currentUrl.toString()
      );
    }

    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      throw new UrlSafetyError(
        "URL_REDIRECT_BLOCKED",
        `URL rejected: redirect location is invalid (${location}).`,
        currentUrl.toString()
      );
    }

    await validateMonitorUrl(nextUrl.toString(), options);
    redirectChain.push(nextUrl.toString());
    currentUrl = nextUrl;
  }

  throw new UrlSafetyError(
    "URL_TOO_MANY_REDIRECTS",
    `URL rejected: redirect limit exceeded (${maxRedirects}).`,
    currentUrl.toString()
  );
}

export async function readResponseTextCapped(
  response: Response,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES
): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new UrlSafetyError(
          "RESPONSE_TOO_LARGE",
          `Response rejected: body exceeded ${maxBytes} bytes.`
        );
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}
