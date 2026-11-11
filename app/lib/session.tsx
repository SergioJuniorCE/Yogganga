import * as SecureStore from 'expo-secure-store'
import Storage from 'expo-sqlite/kv-store'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  configure,
  login as apiLogin,
  logout as apiLogout,
  me as apiMe,
  register as apiRegister,
  setUnauthorizedHandler,
  type User,
} from './api'
import { saveProfile } from './profiles'

const TOKEN_KEY = 'manga.session'
const SERVER_KEY = 'serverUrl'
const USER_KEY = 'user'

type Status = 'loading' | 'signedOut' | 'signedIn'

type SessionValue = {
  status: Status
  serverUrl: string
  user: User | null
  signIn: (serverUrl: string, username: string, password: string) => Promise<void>
  signUp: (serverUrl: string, username: string, password: string, invite: string) => Promise<void>
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionValue>({
  status: 'loading',
  serverUrl: '',
  user: null,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
})

function parseUser(value: string | null): User | null {
  if (!value) return null
  try {
    return JSON.parse(value) as User
  } catch {
    return null
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [serverUrl, setServerUrl] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const serverRef = useRef('')

  useEffect(() => {
    serverRef.current = serverUrl
  }, [serverUrl])

  const clearSession = useCallback(async () => {
    configure(serverRef.current, '')
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {})
    await Storage.removeItem(USER_KEY).catch(() => {})
    setUser(null)
    setStatus('signedOut')
  }, [])

  // A 401 from any request means the session is gone: drop straight to login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void clearSession()
    })
    return () => setUnauthorizedHandler(null)
  }, [clearSession])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const [storedUrl, token, storedUser] = await Promise.all([
        Storage.getItem(SERVER_KEY),
        SecureStore.getItemAsync(TOKEN_KEY),
        Storage.getItem(USER_KEY),
      ])
      if (cancelled) return

      const url = storedUrl ?? process.env.EXPO_PUBLIC_SERVER_URL ?? ''
      setServerUrl(url)
      serverRef.current = url
      configure(url, token ?? '')

      if (url && token) {
        setUser(parseUser(storedUser))
        setStatus('signedIn')
        // Confirm the session in the background; a 401 signs us out above.
        apiMe()
          .then(({ user: fresh }) => {
            setUser(fresh)
            return Storage.setItem(USER_KEY, JSON.stringify(fresh))
          })
          .catch(() => {})
      } else {
        setStatus('signedOut')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const persist = useCallback(async (url: string, token: string, nextUser: User) => {
    configure(url, token)
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, token),
      Storage.setItem(SERVER_KEY, url),
      Storage.setItem(USER_KEY, JSON.stringify(nextUser)),
    ])
    setServerUrl(url)
    serverRef.current = url
    setUser(nextUser)
    setStatus('signedIn')
  }, [])

  const signIn = useCallback(
    async (url: string, username: string, password: string) => {
      const clean = url.trim().replace(/\/+$/, '')
      configure(clean, '')
      const result = await apiLogin(username, password)
      await persist(clean, result.token, result.user)
      await saveProfile(clean, result.user.username, password).catch(() => {})
    },
    [persist],
  )

  const signUp = useCallback(
    async (url: string, username: string, password: string, invite: string) => {
      const clean = url.trim().replace(/\/+$/, '')
      configure(clean, '')
      const result = await apiRegister(username, password, invite)
      await persist(clean, result.token, result.user)
      await saveProfile(clean, result.user.username, password).catch(() => {})
    },
    [persist],
  )

  const signOut = useCallback(async () => {
    await apiLogout().catch(() => {})
    await clearSession()
  }, [clearSession])

  const value = useMemo(
    () => ({ status, serverUrl, user, signIn, signUp, signOut }),
    [status, serverUrl, user, signIn, signUp, signOut],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  return useContext(SessionContext)
}
