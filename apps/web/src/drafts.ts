import type { LookupItem } from '@boat/domain/api'
import { type LookupKind, type Lot, type Product, stamp } from '@boat/domain/models'
import { values } from './api/mappers'

// The preferred value while Settings still has it, otherwise the first value of its kind.
export function defaultValue(lookups: LookupItem[], kind: LookupKind, preferred: string) {
  const options = values(lookups, kind)
  return options.includes(preferred) ? preferred : (options[0] ?? '')
}

export const newProduct = (lookups: LookupItem[]): Product =>
  stamp({ name: '', variant: '', segment: defaultValue(lookups, 'segment', 'PA / TWS') })

// A blank lot for a product, with the demo's default dropdown values.
export const newLot = (productId: string, lookups: LookupItem[]): Lot =>
  stamp({
    productId,
    label: '',
    category: defaultValue(lookups, 'category', 'BAU'),
    directFg: false,
    ems: '',
    poc: '',
    status: defaultValue(lookups, 'status', 'On Track'),
    stage: defaultValue(lookups, 'stage', 'RM Sourcing'),
    rmMode: 'all' as const,
    rmComponents: [],
    readyQty: 0,
    lotQty: 0,
    freshProductionQty: 0,
    reworkQty: 0,
    reworkReason: '',
    rmReadyDate: '',
    plannedDate: '',
    revisedEta: '',
    actualDate: '',
    logisticsMode: '',
    blockerCategory: defaultValue(lookups, 'blocker', 'None'),
    blockerDescription: '',
    followUpDate: '',
    followUpNote: '',
  })
