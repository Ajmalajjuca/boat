import type { AddressInfo } from 'node:net'
import express from 'express'
import { describe, expect, it } from 'vitest'
import { listen } from './listen'

describe('listen', () => {
  it('resolves once the port is bound', async () => {
    const server = await listen(express(), 0)
    expect(server.listening).toBe(true)
    server.close()
  })
  it('rejects when the port is already taken instead of reporting success', async () => {
    const first = await listen(express(), 0)
    try {
      const { port } = first.address() as AddressInfo
      await expect(listen(express(), port)).rejects.toMatchObject({ code: 'EADDRINUSE' })
    } finally {
      first.close()
    }
  })
})
