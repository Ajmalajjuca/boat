import { PermissionError } from '@boat/domain/permissions'
import { ValidationError } from '@boat/domain/validation'
import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { ConflictError, errorHandler, NotFoundError, UnauthenticatedError } from './errors'

function throwing(err: Error) {
  const app = express()
  app.get('/', () => {
    throw err
  })
  app.use(errorHandler)
  return app
}

describe('errorHandler', () => {
  it.each([
    {
      name: 'validation',
      err: new ValidationError({ quantity: 'Must be more than zero.' }),
      status: 422,
      body: { error: 'validation', fields: { quantity: 'Must be more than zero.' } },
    },
    {
      name: 'permission',
      err: new PermissionError("Viewer profiles can't delete lots. Ask an admin."),
      status: 403,
      body: { error: 'forbidden', message: "Viewer profiles can't delete lots. Ask an admin." },
    },
    {
      name: 'no session',
      err: new UnauthenticatedError(),
      status: 401,
      body: { error: 'unauthenticated' },
    },
    {
      name: 'failed sign-in',
      err: new UnauthenticatedError('Email or password is incorrect.'),
      status: 401,
      body: { error: 'unauthenticated', message: 'Email or password is incorrect.' },
    },
    { name: 'not found', err: new NotFoundError(), status: 404, body: { error: 'not_found' } },
    {
      name: 'conflict with the current record',
      err: new ConflictError('Someone else changed this.', { id: 'x' }),
      status: 409,
      body: { error: 'conflict', message: 'Someone else changed this.', current: { id: 'x' } },
    },
    {
      name: 'conflict without a record',
      err: new ConflictError('Still in use.'),
      status: 409,
      body: { error: 'conflict', message: 'Still in use.' },
    },
  ])('answers $name with $status', async ({ err, status, body }) => {
    const res = await request(throwing(err)).get('/')
    expect(res.status).toBe(status)
    expect(res.body).toEqual(body)
  })
})
