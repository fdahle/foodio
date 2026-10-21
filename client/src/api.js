export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function parse(res, path) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('foodio:unauthorized'))
    // Logged in with a temporary password (after a reset): choose your own first.
    if (data.code === 'must_change_password') window.dispatchEvent(new Event('foodio:must-change-password'))
    throw new ApiError(res.status, data.error || (res.status === 429 ? 'Too many attempts, try again in a few minutes' : 'Request failed'))
  }
  return data
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  return parse(res, path)
}

// The illustration of a dish you added.
export async function uploadImage(dishId, blob) {
  const path = `/dishes/${dishId}/image`
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type },
    body: blob,
    credentials: 'same-origin',
  })
  return parse(res, path)
}
