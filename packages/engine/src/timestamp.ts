// RFC 3161 timestamps of the ledger head: a public timestamp authority signs the head
// hash, which proves the chain up to that row existed at the signed time. Only the
// request is built and the reply sanity-checked here; anyone can verify the full
// signature with `openssl ts -verify`.

const HEX_SHA256 = /^[0-9a-f]{64}$/;

// TimeStampReq { version 1, MessageImprint { sha256, hash }, certReq TRUE }, no nonce or policy.
const REQUEST_HEAD = [0x30, 0x39, 0x02, 0x01, 0x01, 0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20];
const CERT_REQ = [0x01, 0x01, 0xff];

/** The DER TimeStampReq for a sha256 hex digest (the ledger hash itself). */
export function timestampRequest(hashHex: string): Uint8Array {
  if (!HEX_SHA256.test(hashHex)) throw new Error("not a sha256 hex digest");
  return Uint8Array.from([...REQUEST_HEAD, ...Buffer.from(hashHex, "hex"), ...CERT_REQ]);
}

type Tlv = { tag: number; start: number; end: number };

/** One DER element at `at`: its tag and content bounds, or null when it runs past the bytes. */
function tlv(b: Uint8Array, at: number): Tlv | null {
  if (at + 2 > b.length) return null;
  const tag = b[at]!;
  let len = b[at + 1]!;
  let start = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 3 || start + n > b.length) return null;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[start + i]!;
    start += n;
  }
  return start + len > b.length ? null : { tag, start, end: start + len };
}

function indexOf(b: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let i = from; i + needle.length <= b.length; i++) {
    for (let j = 0; j < needle.length; j++) if (b[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

const GENERALIZED_TIME = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/;

/**
 * A granted TimeStampResp that carries this hash, with the time the authority signed it;
 * null for a refused, malformed or other-hash reply. The signature itself is not checked.
 */
export function readTimestampReply(der: Uint8Array, hashHex: string): { signed_at: Date } | null {
  const resp = tlv(der, 0);
  const info = resp?.tag === 0x30 ? tlv(der, resp.start) : null;
  const status = info?.tag === 0x30 ? tlv(der, info.start) : null;
  // PKIStatus granted (0) or grantedWithMods (1).
  if (!resp || !info || status?.tag !== 0x02 || status.end - status.start !== 1 || der[status.start]! > 1) return null;

  // TSTInfo: ... MessageImprint { alg, OCTET STRING hash }, serialNumber INTEGER, genTime GeneralizedTime.
  const imprint = Uint8Array.from([0x04, 0x20, ...Buffer.from(hashHex, "hex")]);
  const at = HEX_SHA256.test(hashHex) ? indexOf(der, imprint, info.end) : -1;
  if (at < 0) return null;
  const serial = tlv(der, at + imprint.length);
  const time = serial?.tag === 0x02 ? tlv(der, serial.end) : null;
  if (time?.tag !== 0x18) return null;
  const m = GENERALIZED_TIME.exec(Buffer.from(der.subarray(time.start, time.end)).toString("latin1"));
  if (!m) return null;
  const signed_at = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ?? ""}Z`);
  return Number.isNaN(signed_at.getTime()) ? null : { signed_at };
}
