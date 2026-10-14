import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Migrations need the owner role on a direct, non-pooled connection. process.env (not env())
  // keeps `prisma generate` working in CI, where no database URL is set.
  datasource: { url: process.env.DIRECT_URL ?? '' },
})
