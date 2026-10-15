import { collect } from '@boat/domain/validation'
import { roles, validatePin } from './access'
import type { UserProfile } from './models'

export * from '@boat/domain/validation'

const blank = (s: string) => !s.trim()

// pin and confirm are blank when an existing PIN is kept. Viewers may have no PIN at all.
export function validateUser(u: UserProfile, pin: string, confirm: string) {
  const changingPin = !!(pin || confirm)
  return collect([
    ['name', blank(u.name) && 'Enter a name.'],
    ['name', u.name.trim().length > 40 && 'Keep the name to 40 characters or fewer.'],
    ['role', !roles.includes(u.role) && 'Choose a role.'],
    ['poc', u.role === 'poc' && blank(u.poc) && 'Choose the point of contact this profile owns.'],
    ['pin', changingPin && validatePin(pin)],
    ['confirm', changingPin && !validatePin(pin) && validatePin(pin, confirm)],
    ['pin', !changingPin && u.role !== 'viewer' && !u.pinHash && 'Set a PIN of 4 to 8 digits.'],
  ])
}
