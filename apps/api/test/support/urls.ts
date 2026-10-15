export const templateDb = 'boat_template'

export function withDatabase(
  url: string,
  database: string,
  user?: { name: string; password: string },
) {
  const u = new URL(url)
  u.pathname = `/${database}`
  if (user) {
    u.username = user.name
    u.password = user.password
  }
  return u.toString()
}
