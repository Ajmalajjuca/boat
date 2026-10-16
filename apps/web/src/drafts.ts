import type { LookupItem } from '@boat/domain/api'
import { type LookupKind, type Product, stamp } from '@boat/domain/models'
import { values } from './api/mappers'

// The preferred value while Settings still has it, otherwise the first value of its kind.
export function defaultValue(lookups: LookupItem[], kind: LookupKind, preferred: string) {
  const options = values(lookups, kind)
  return options.includes(preferred) ? preferred : (options[0] ?? '')
}

export const newProduct = (lookups: LookupItem[]): Product =>
  stamp({ name: '', variant: '', segment: defaultValue(lookups, 'segment', 'PA / TWS') })
