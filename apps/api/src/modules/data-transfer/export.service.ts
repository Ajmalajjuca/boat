import { type Backup, BACKUP_APP, SCHEMA_VERSION } from '@boat/domain/backup'
import type { Db } from '../../core/prisma'
import { currentDataSet } from './backup-mapping'

// FR-9.1: the demo's backup format, so a server export imports into the demo and back.
export async function exportBackup(db: Db): Promise<Backup> {
  return {
    app: BACKUP_APP,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: await currentDataSet(db),
  }
}
