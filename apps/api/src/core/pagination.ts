import { z } from 'zod'

// PRD: lists take ?page=&pageSize= (default 50, max 200) and return { items, total, page, pageSize }.
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})
export type Page = z.infer<typeof pageQuery>

export const pageArgs = ({ page, pageSize }: Page) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
})
export const pageOf = <T>(items: T[], total: number, { page, pageSize }: Page) => ({
  items,
  total,
  page,
  pageSize,
})
