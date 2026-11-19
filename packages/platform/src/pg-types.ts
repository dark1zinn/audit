import { Result } from "effect"
import * as PgTypes from "@effect/sql-pg/PgTypes"

/**
 * `@effect/sql-pg` has no codec for tsvector (OID 3614), so any row containing `entities.search`
 * would fail to decode. This read-only codec turns the binary form into its text form
 * (`'lexeme':1A,2`); the column is maintained by a trigger and never written by the app.
 */
const TSVECTOR_OID = 3614
const WEIGHTS = ["D", "C", "B", "A"] as const

const tsvectorCodec: PgTypes.Codec<string> = {
  encode: () =>
    Result.fail(new PgTypes.CodecError({ message: "tsvector is maintained by a trigger" })),
  decode: (bytes) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const decoder = new TextDecoder()
    const entries: Array<string> = []
    let offset = 4
    for (let i = 0, count = view.getInt32(0); i < count; i++) {
      const end = bytes.indexOf(0, offset)
      const lexeme = decoder.decode(bytes.subarray(offset, end))
      offset = end + 1
      const positionCount = view.getUint16(offset)
      offset += 2
      const positions: Array<string> = []
      for (let p = 0; p < positionCount; p++) {
        const raw = view.getUint16(offset)
        offset += 2
        const weight = raw >> 14
        positions.push(`${raw & 0x3fff}${weight === 0 ? "" : WEIGHTS[weight]}`)
      }
      entries.push(positions.length === 0 ? `'${lexeme}'` : `'${lexeme}':${positions.join(",")}`)
    }
    return Result.succeed(entries.join(" "))
  },
}

export const pgTypes = PgTypes.makeRegistry()
pgTypes.register(TSVECTOR_OID, tsvectorCodec)
