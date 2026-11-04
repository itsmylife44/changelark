// Minimal CBOR decoder (RFC 8949) for App Attest objects: integers, byte and text strings, arrays, maps, simple values.
// ponytail: no floats, tags or indefinite lengths; Apple's attestation and assertion objects don't use them.

export type Cbor = number | bigint | string | Buffer | boolean | null | undefined | Cbor[] | Map<Cbor, Cbor>;

export function decodeCbor(buf: Buffer): Cbor {
  let pos = 0;
  const byte = () => {
    if (pos >= buf.length) throw new Error("CBOR: unexpected end");
    return buf[pos++];
  };
  const length = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) return byte();
    if (info === 25) { const v = buf.readUInt16BE(pos); pos += 2; return v; }
    if (info === 26) { const v = buf.readUInt32BE(pos); pos += 4; return v; }
    if (info === 27) { const v = buf.readBigUInt64BE(pos); pos += 8; if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("CBOR: length too large"); return Number(v); }
    throw new Error("CBOR: unsupported length encoding");
  };
  const take = (n: number) => {
    if (pos + n > buf.length) throw new Error("CBOR: unexpected end");
    const out = buf.subarray(pos, pos + n);
    pos += n;
    return Buffer.from(out);
  };
  const item = (depth: number): Cbor => {
    if (depth > 16) throw new Error("CBOR: nested too deep");
    const head = byte();
    const major = head >> 5, info = head & 31;
    switch (major) {
      case 0: return length(info);
      case 1: return -1 - length(info);
      case 2: return take(length(info));
      case 3: return take(length(info)).toString("utf8");
      case 4: { const n = length(info); const arr: Cbor[] = []; for (let i = 0; i < n; i++) arr.push(item(depth + 1)); return arr; }
      case 5: { const n = length(info); const map = new Map<Cbor, Cbor>(); for (let i = 0; i < n; i++) map.set(item(depth + 1), item(depth + 1)); return map; }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        throw new Error("CBOR: unsupported simple value");
      default: throw new Error("CBOR: unsupported type");
    }
  };
  const value = item(0);
  if (pos !== buf.length) throw new Error("CBOR: trailing bytes");
  return value;
}
