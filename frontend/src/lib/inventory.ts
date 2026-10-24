import type { AllocationPayload, Item } from '../api/types'
import { ITEMS } from '../api/types'
import { shortName } from './format'

export const ITEM_LABELS: Record<Item, string> = {
  ppe_units: 'PPE', antiviral_doses: 'Antivirals', vaccine_doses: 'Vaccines',
}

export interface HubBar {
  hub: string
  name: string
  role: 'target' | 'donor'
  before: number
  after: number
}

/**
 * Before/after stock for the episode's target and donors, per item, from the allocation
 * payload (exact for that episode): target before/after are recorded; a donor's "before"
 * is what it had after giving plus what it gave.
 */
export function inventoryBars(payload: AllocationPayload, targetName: string): Record<Item, HubBar[]> {
  const result = {} as Record<Item, HubBar[]>
  for (const item of ITEMS) {
    result[item] = [
      { hub: shortName(targetName), name: targetName, role: 'target',
        before: payload.target_before[item], after: payload.target_after[item] },
      ...payload.transfers.map((t): HubBar => ({
        hub: shortName(t.donor_name), name: t.donor_name, role: 'donor',
        before: t.donor_after[item] + t[item], after: t.donor_after[item],
      })),
    ]
  }
  return result
}
