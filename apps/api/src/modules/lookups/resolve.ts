import type { FieldErrors } from '@boat/domain/validation'
import type { Db } from '../../core/prisma'
import { type LookupKind, Prisma } from '../../generated/prisma/client'

export type LookupRef = { field: string; kind: LookupKind; id: string | null; label: string }

// FR-8.3: a record may only use values that exist in Settings. Foreign keys check that a row
// exists, not its kind or whether it is deleted, so this checks both and returns the display
// values for validation and history. FOR SHARE holds the rows until the transaction ends: a
// delete running at the same moment waits, then sees the new use and refuses.
export async function resolveLookups(db: Db, refs: LookupRef[]) {
  const ids = [...new Set(refs.flatMap((r) => (r.id ? [r.id] : [])))]
  const rows = ids.length
    ? await db.$queryRaw<{ id: string; kind: string; value: string }[]>`
        SELECT id, kind::text AS kind, value::text AS value
        FROM lookup_values
        WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
          AND deleted_at IS NULL
        FOR SHARE`
    : []
  const found = new Map(rows.map((r) => [r.id, r]))
  const errors: FieldErrors = {}
  for (const ref of refs) {
    if (!ref.id) continue
    if (found.get(ref.id)?.kind !== ref.kind)
      errors[ref.field] ??= `Choose ${ref.label} from the list.`
  }
  const valueOf = (id: string | null) => (id && found.get(id)?.value) || ''
  return { valueOf, errors }
}

// The domain validators name dropdown fields after the browser's text fields (status); the API
// takes ids (statusId). This moves each message to the field the request used.
export const renameFields = (errors: FieldErrors, names: Record<string, string>) =>
  Object.fromEntries(Object.entries(errors).map(([k, v]) => [names[k] ?? k, v])) as FieldErrors
