import type { BatchItem, LookupItem, ReceiptItem } from '@boat/domain/api'
import type { GRNReceipt, RMBatch } from '@boat/domain/models'
import { api } from './client'
import { batchField, batchInput, receiptInput } from './mappers'

// Batches and receipts carry no version: the server orders writes with the lot's row lock and
// checks the receipt total there.
export async function saveBatch(
  lotId: string,
  batch: RMBatch,
  lookups: LookupItem[],
  existing: boolean,
) {
  const input = batchInput(batch, lookups)
  const options = { fields: batchField }
  if (existing) await api.patch<BatchItem>(`/rm-batches/${batch.id}`, input, options)
  else await api.post<BatchItem>(`/lots/${lotId}/rm-batches`, input, options)
}
export const deleteBatch = (id: string) => api.delete(`/rm-batches/${id}`)

export async function saveReceipt(lotId: string, receipt: GRNReceipt, existing: boolean) {
  const input = receiptInput(receipt)
  if (existing) await api.patch<ReceiptItem>(`/grn-receipts/${receipt.id}`, input)
  else await api.post<ReceiptItem>(`/lots/${lotId}/grn-receipts`, input)
}
export const deleteReceipt = (id: string) => api.delete(`/grn-receipts/${id}`)
