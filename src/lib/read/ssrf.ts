import { promises as dns } from "node:dns";
import { BlockList, isIP } from "node:net";

export type LookupFn = (hostname: string) => Promise<string[]>;

export type SsrfDecision =
  | { ok: true; url: URL; addresses: string[] }
  | { ok: false; reason: string };

const blocked = new BlockList();
blocked.addSubnet("0.0.0.0", 8, "ipv4");
blocked.addSubnet("10.0.0.0", 8, "ipv4");
blocked.addSubnet("100.64.0.0", 10, "ipv4");
blocked.addSubnet("127.0.0.0", 8, "ipv4");
blocked.addSubnet("169.254.0.0", 16, "ipv4");
blocked.addSubnet("172.16.0.0", 12, "ipv4");
blocked.addSubnet("192.168.0.0", 16, "ipv4");
blocked.addSubnet("224.0.0.0", 4, "ipv4");
blocked.addSubnet("240.0.0.0", 4, "ipv4");
blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
blocked.addSubnet("fc00::", 7, "ipv6");
blocked.addSubnet("fe80::", 10, "ipv6");
blocked.addSubnet("ff00::", 8, "ipv6");

function mappedIpv4(ip: string): string | null {
  const lower = ip.toLowerCase();
  if (!lower.startsWith("::ffff:")) return null;
  const rest = ip.slice(ip.toLowerCase().indexOf("::ffff:") + "::ffff:".length);
  return isIP(rest) === 4 ? rest : null;
}

export function isBlockedIp(ip: string): boolean {
  const mapped = mappedIpv4(ip);
  if (mapped) return isBlockedIp(mapped);

  const version = isIP(ip);
  if (version === 4) return blocked.check(ip, "ipv4");
  if (version === 6) return blocked.check(ip, "ipv6");
  return true;
}

export async function defaultLookup(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

export async function assertPublicHttpUrl(
  value: string,
  lookup: LookupFn = defaultLookup,
): Promise<SsrfDecision> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "URL 无效" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "只允许 HTTP(S) 地址" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "拒绝带凭据的 URL" };
  }

  const hostname = url.hostname;
  if (!hostname) return { ok: false, reason: "URL 缺少主机名" };

  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      return { ok: false, reason: "拒绝访问私网或本机地址" };
    }
    return { ok: true, url, addresses: [hostname] };
  }

  let addresses: string[];
  try {
    addresses = await lookup(hostname);
  } catch {
    return { ok: false, reason: "无法解析主机名" };
  }
  if (addresses.length === 0) {
    return { ok: false, reason: "无法解析主机名" };
  }
  if (addresses.some((address) => isBlockedIp(address))) {
    return { ok: false, reason: "主机解析到私网或本机地址，已拒绝" };
  }
  return { ok: true, url, addresses };
}
