// ============================================================
//  ArcenPay Facilitator — Stellar ScVal Decoding Helpers
//
//  Parses Stellar Soroban XDR `ScVal` values into plain JS primitives.
//  Uses `switch().name` for type discrimination (matching the
//  `ScValType.name` string like "scvU128", "scvSymbol", etc.).
// ============================================================

import { type xdr } from "@stellar/stellar-sdk/base";

type ScVal = xdr.ScVal;
type ScMapEntry = xdr.ScMapEntry;

/**
 * Decode a single ScVal to a plain JS value.
 *
 * Returns:
 *   - boolean    ScvBool
 *   - null       ScvVoid, or null
 *   - bigint     ScvU32, ScvI32, ScvU64, ScvI64, ScvU128, ScvI128,
 *                 ScvTimepoint, ScvDuration
 *   - string     ScvString, ScvSymbol, ScvBytes (hex), ScvAddress
 *   - unknown[]  ScvVec
 *   - Record<string, unknown>  ScvMap
 */
export function scValToJs(val: ScVal): unknown {
  const typeName = val.switch().name;

  switch (typeName) {
    case "scvBool":         return val.b() as unknown as boolean;
    case "scvVoid":         return null;
    case "scvError":        return String(val.error());
    case "scvU32":          return BigInt(val.u32());
    case "scvI32":          return BigInt(val.i32());
    case "scvU64":          return BigInt(val.u64().toBigInt());
    case "scvI64":          return BigInt(val.i64().toBigInt());
    case "scvTimepoint":    return BigInt(val.timepoint().toBigInt());
    case "scvDuration":     return BigInt(val.duration().toBigInt());
    case "scvU128":         {
      const parts = val.u128();
      return (parts.hi().toBigInt() << 64n) | parts.lo().toBigInt();
    }
    case "scvI128":         {
      const parts = val.i128();
      return (parts.hi().toBigInt() << 64n) | parts.lo().toBigInt();
    }
    case "scvU256":         {
      const parts = val.u256();
      return (parts.hiHi().toBigInt() << 192n) | (parts.hiLo().toBigInt() << 128n) |
             (parts.loHi().toBigInt() << 64n)   | parts.loLo().toBigInt();
    }
    case "scvI256":         {
      const parts = val.i256();
      return (parts.hiHi().toBigInt() << 192n) | (parts.hiLo().toBigInt() << 128n) |
             (parts.loHi().toBigInt() << 64n)   | parts.loLo().toBigInt();
    }
    case "scvBytes":        return String(val.bytes());
    case "scvString":       return String(val.str());
    case "scvSymbol":       return String(val.sym());
    case "scvAddress": {
      const addr = val.address();
      return addr ? String(addr.toString()) : "";
    }
    case "scvVec": {
      const vec = val.vec();
      if (!vec || !Array.isArray(vec)) return [];
      return vec.map((item: ScVal) => scValToJs(item));
    }
    case "scvMap": {
      const mapEntries = val.map();
      if (!mapEntries || !Array.isArray(mapEntries)) return {};
      const result: Record<string, unknown> = {};
      for (const entry of mapEntries) {
        try {
          const key = String(scValToJs(entry.key()));
          result[key] = scValToJs(entry.val());
        } catch {
          // skip un-decodable entries
        }
      }
      return result;
    }
    case "scvContractInstance":
    case "scvLedgerKeyContractInstance":
    case "scvLedgerKeyNonce":
    default:
      return null;
  }
}

export function scValSymbolToString(val: ScVal): string {
  return String(scValToJs(val) ?? "");
}

export function scValToBigInt(val: ScVal): bigint {
  const js = scValToJs(val);
  if (typeof js === "bigint") return js;
  if (typeof js === "number") return BigInt(js);
  if (typeof js === "string") return BigInt(js);
  return BigInt(0);
}

export function scValToNumber(val: ScVal): number {
  const js = scValToJs(val);
  if (typeof js === "number") return js;
  if (typeof js === "bigint") return Number(js);
  if (typeof js === "string") return Number(js);
  return 0;
}

export function scValVecGet(val: ScVal, index: number): unknown {
  const vec = val.vec();
  if (!vec || !Array.isArray(vec)) return null;
  if (index >= vec.length) return null;
  return scValToJs(vec[index]);
}
