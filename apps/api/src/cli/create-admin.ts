import 'dotenv/config'
import { parseArgs } from 'node:util'
import { ValidationError } from '@boat/domain/validation'
import { loadConfig } from '../config'
import { createLogger } from '../core/logger'
import { createMailer } from '../core/mailer'
import { createPrisma } from '../core/prisma'
import { inviteFirstAdmin } from '../modules/users/users.service'

// Invites the first admin of a new deployment:
//   pnpm api create-admin --email you@example.com --name "Your Name"
//   node apps/api/dist/create-admin.js --email you@example.com --name "Your Name"   (Render Shell)
const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } })
if (!values.email || !values.name) {
  console.error('Usage: create-admin --email <address> --name <name>')
  process.exit(2)
}

const config = loadConfig(process.env)
const logger = createLogger(config.LOG_LEVEL)
const db = createPrisma(config.DATABASE_URL)
try {
  const { user, inviteEmailSent, inviteUrl } = await inviteFirstAdmin(
    { db, mailer: createMailer(config, logger), appUrl: config.APP_URL, allowedDomains: [] },
    { email: values.email, name: values.name },
    logger,
  )
  console.log(`Invited ${user.email} as admin.`)
  console.log(
    inviteEmailSent ? 'The invite email is on its way.' : 'The invite email was not sent.',
  )
  console.log(`Invite link (valid for 72 hours): ${inviteUrl}`)
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
