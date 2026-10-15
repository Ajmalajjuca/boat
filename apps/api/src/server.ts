import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app'
import { loadConfig } from './config'
import { listen } from './core/listen'
import { createLogger } from './core/logger'
import { createPrisma, databaseCheck } from './core/prisma'

const config = loadConfig(process.env)
const logger = createLogger(config.LOG_LEVEL)
const prisma = createPrisma(config.DATABASE_URL)
// Same relative path from src/ (tsx) and dist/ (bundle): apps/web/dist.
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')

const app = createApp({
  logger,
  webDist,
  trustProxy: config.TRUST_PROXY,
  hsts: config.NODE_ENV === 'production',
  api: {
    db: prisma,
    checkDatabase: databaseCheck(prisma),
    sessionSecret: config.SESSION_SECRET,
    appUrl: config.APP_URL,
    secureCookies: config.NODE_ENV === 'production',
  },
})
const server = await listen(app, config.PORT).catch((err: unknown) => {
  logger.fatal({ err }, 'could not start')
  process.exit(1)
})
logger.info({ port: config.PORT }, 'listening')

function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down')
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0))
  })
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
