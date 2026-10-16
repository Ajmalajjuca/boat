import type { MonthEndReport } from '@boat/domain/api'
import { api, download, queryString } from './client'

export const listMonths = () => api.get<{ items: string[] }>('/reports/months').then((r) => r.items)
export const fetchMonthEnd = (month: string) =>
  api.get<MonthEndReport>(`/reports/month-end${queryString({ month })}`)
export const downloadMonthEndCsv = (month: string) =>
  download(`/reports/month-end/export.csv${queryString({ month })}`)
