import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { db } from './db.ts'

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>

const KEY_LENGTH = 64
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000
const MAX_ATTEMPTS = 10
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000

export type User = {
  id: string
  username: string
  createdAt: number
}

type UserRow = {
  id: string
  username: string
  password_hash: string
  created_at: number
}

// A hash of a random password. Unknown usernames still pay for a scrypt round,
// so response time doesn't reveal whether an account exists.
const DUMMY_HASH = hashPasswordSync(crypto.randomBytes(24).toString('hex'))

function hashPasswordSync(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex')}`
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, KEY_LENGTH)
  return `scrypt$${salt}$${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, expected] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !expected) return false
  const candidate = await scrypt(password, salt, KEY_LENGTH)
  const expectedBuffer = Buffer.from(expected, 'hex')
  return candidate.length === expectedBuffer.length && crypto.timingSafeEqual(candidate, expectedBuffer)
}

export function burnPasswordCheck(password: string): Promise<boolean> {
  return verifyPassword(password, DUMMY_HASH)
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

export function userCount(): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
  return row.count
}

export function findUserByUsername(username: string): (User & { passwordHash: string }) | null {
  const row = db
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .get(username) as UserRow | undefined
  if (!row) return null
  return { id: row.id, username: row.username, createdAt: row.created_at, passwordHash: row.password_hash }
}

export async function createUser(username: string, password: string): Promise<User> {
  const id = crypto.randomUUID()
  const createdAt = Date.now()
  const passwordHash = await hashPassword(password)
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    username,
    passwordHash,
    createdAt,
  )
  return { id, username, createdAt }
}

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function createSession(userId: string): string {
  const token = crypto.randomBytes(32).toString('base64url')
  const now = Date.now()
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    tokenHash(token),
    userId,
    now,
    now + SESSION_TTL_MS,
  )
  return token
}

export function userForToken(token: string): User | null {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(tokenHash(token), Date.now()) as { id: string; username: string; created_at: number } | undefined
  return row ? { id: row.id, username: row.username, createdAt: row.created_at } : null
}

export function revokeSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token))
}

export function purgeExpiredSessions(): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
}

/* ---------- login rate limiting ---------- */

type Attempt = { count: number; resetAt: number }
const attempts = new Map<string, Attempt>()

export function loginAllowed(key: string): boolean {
  const entry = attempts.get(key)
  if (!entry || entry.resetAt <= Date.now()) return true
  return entry.count < MAX_ATTEMPTS
}

export function recordLoginFailure(key: string): void {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS })
    return
  }
  entry.count += 1
}

export function clearLoginFailures(key: string): void {
  attempts.delete(key)
}
