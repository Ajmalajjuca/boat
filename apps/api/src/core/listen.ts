import type { Server } from 'node:http'
import type { Express } from 'express'

// Resolves once the port is bound. Express 5 hands listen errors (EADDRINUSE, EACCES) to the
// callback as if the server had started, so they are turned into a rejection here.
export function listen(app: Express, port: number) {
  return new Promise<Server>((resolve, reject) => {
    const server = app.listen(port, (err?: Error) => (err ? reject(err) : resolve(server)))
  })
}
