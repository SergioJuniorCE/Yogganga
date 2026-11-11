import * as SecureStore from 'expo-secure-store'
import Storage from 'expo-sqlite/kv-store'

const INDEX_KEY = 'profiles'
const MAX_PROFILES = 8

export type Profile = {
  id: string
  serverUrl: string
  username: string
  password: string
}

type StoredProfile = Omit<Profile, 'password'>

// Passwords live in SecureStore one key each; the profile list itself is not secret.
const passwordKey = (id: string) => `manga.profile.${id}`

function isStoredProfile(value: unknown): value is StoredProfile {
  if (!value || typeof value !== 'object') return false
  const profile = value as Record<string, unknown>
  return (
    typeof profile.id === 'string' &&
    typeof profile.serverUrl === 'string' &&
    typeof profile.username === 'string'
  )
}

async function readIndex(): Promise<StoredProfile[]> {
  const raw = await Storage.getItem(INDEX_KEY).catch(() => null)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isStoredProfile) : []
  } catch {
    return []
  }
}

async function writeIndex(profiles: StoredProfile[]): Promise<void> {
  await Storage.setItem(INDEX_KEY, JSON.stringify(profiles))
}

export async function loadProfiles(): Promise<Profile[]> {
  const stored = await readIndex()
  const profiles = await Promise.all(
    stored.map(async (profile) => {
      const password = await SecureStore.getItemAsync(passwordKey(profile.id)).catch(() => null)
      return password === null ? null : { ...profile, password }
    }),
  )
  return profiles.filter((profile): profile is Profile => profile !== null)
}

export async function saveProfile(serverUrl: string, username: string, password: string): Promise<void> {
  const stored = await readIndex()
  const existing = stored.find(
    (profile) =>
      profile.serverUrl === serverUrl && profile.username.toLowerCase() === username.toLowerCase(),
  )
  const id = existing?.id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

  await SecureStore.setItemAsync(passwordKey(id), password)
  const next = [{ id, serverUrl, username }, ...stored.filter((profile) => profile.id !== id)]
  await Promise.all(
    next.slice(MAX_PROFILES).map((profile) =>
      SecureStore.deleteItemAsync(passwordKey(profile.id)).catch(() => {}),
    ),
  )
  await writeIndex(next.slice(0, MAX_PROFILES))
}

export async function removeProfile(id: string): Promise<void> {
  await SecureStore.deleteItemAsync(passwordKey(id)).catch(() => {})
  await writeIndex((await readIndex()).filter((profile) => profile.id !== id))
}
