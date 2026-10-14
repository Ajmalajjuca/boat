import type { RecordBase, Role } from '@boat/domain/models'

export * from '@boat/domain/models'

// Profiles stay in this browser only: they are never exported, imported, or cleared by a reset.
export interface UserProfile extends RecordBase {
  name: string
  role: Role
  // The point-of-contact value a POC profile owns; empty for other roles.
  poc: string
  pinHash: string
  pinSalt: string
}
export interface LocalSetting {
  key: string
  value: string
}
