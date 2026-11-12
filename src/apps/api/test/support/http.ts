import request from "supertest"
import { expect } from "vitest"

import { createApp } from "@/app.ts"

// Call from a file that calls stubSessions(), so the request's session can be stubbed
export const api = () => request(createApp())

// Checks the status, putting the response body in the failure message so it shows why the request got another status
export function expectStatus(response: request.Response, status: number) {
  expect(response.status, `Response body: ${JSON.stringify(response.body, null, 2)}`).toBe(status)
}

export function expectError(response: request.Response, status: number, code: string) {
  expectStatus(response, status)
  expect(response.body.error.code).toBe(code)
}
