import 'dotenv/config'
import { parseArgs } from 'node:util'
import { ValidationError } from '@boat/domain/validation'
import { loadConfig } from '../config'
import { createPrisma } from '../core/prisma'
import { setBackupAdmin } from '../modules/users/users.service'

// Sets up the backup admin, the one account that signs in with a password (FR-11.6), and
// prints its new password once. Run it again with the same email to reset that password:
//   pnpm api create-admin --email you@example.com --name "Your Name"
//   node apps/api/dist/create-admin.js --email you@example.com --name "Your Name"   (Render Shell)
const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } })
if (!values.email || !values.name) {
  console.error('Usage: create-admin --email <address> --name <name>')
  process.exit(2)
}

const config = loadConfig(process.env)
const db = createPrisma(config.DATABASE_URL)
try {
  const { user, password } = await setBackupAdmin(db, { email: values.email, name: values.name })
  console.log(`Backup admin: ${user.email}`)
  console.log(`Password (shown once): ${password}`)
  console.log('Store it somewhere safe. Everyone else signs in with Google.')
} catch (err) {
  const messages =
    err instanceof ValidationError
      ? Object.values(err.fields)
      : [err instanceof Error ? err.message : String(err)]
  for (const message of messages) console.error(message)
  process.exitCode = 1
} finally {
  await db.$disconnect()
}
