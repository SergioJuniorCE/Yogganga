import * as Application from 'expo-application'
import Constants, { ExecutionEnvironment } from 'expo-constants'
import * as FileSystem from 'expo-file-system/legacy'
import { Alert, Platform } from 'react-native'

const RELEASE_URL = 'https://api.github.com/repos/SergioJuniorCE/Yogganga/releases/tags/nightly'
const APK_NAME = 'yogganga-nightly.apk'
const UPDATE_TIMEOUT_MS = 10_000

type Release = {
  name?: string
  body?: string
  assets?: { name: string; browser_download_url: string }[]
}

export type AppUpdate = {
  versionCode: number
  versionName: string
  downloadUrl: string
}

export function updatesSupported(): boolean {
  return Platform.OS === 'android' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
}

export async function checkForUpdate(): Promise<AppUpdate | null> {
  if (!updatesSupported()) return null

  const installed = Number(Application.nativeBuildVersion)
  if (!Number.isFinite(installed)) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPDATE_TIMEOUT_MS)

  try {
    const response = await fetch(RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Yogganga' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`)
    const release = (await response.json()) as Release

    const versionCode = Number(/^versionCode:\s*(\d+)$/m.exec(release.body ?? '')?.[1])
    const asset = release.assets?.find((entry) => entry.name === APK_NAME)
    if (!versionCode || !asset || versionCode <= installed) return null

    return {
      versionCode,
      versionName: release.name ?? `nightly ${versionCode}`,
      downloadUrl: asset.browser_download_url,
    }
  } catch (cause) {
    if (controller.signal.aborted) throw new Error('Timed out checking for updates')
    throw cause
  } finally {
    clearTimeout(timer)
  }
}

export async function installUpdate(update: AppUpdate): Promise<void> {
  // Only loaded on Android standalone builds, where the native module exists.
  const IntentLauncher = await import('expo-intent-launcher')
  const path = `${FileSystem.cacheDirectory ?? ''}${APK_NAME}`
  await FileSystem.deleteAsync(path, { idempotent: true })
  const { uri } = await FileSystem.downloadAsync(update.downloadUrl, path)
  const contentUri = await FileSystem.getContentUriAsync(uri)
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: 'application/vnd.android.package-archive',
  })
}

export function promptInstall(update: AppUpdate): void {
  Alert.alert('Nightly update available', `${update.versionName} is ready to install.`, [
    { text: 'Later', style: 'cancel' },
    { text: 'Install', onPress: () => void installUpdate(update).catch(showError) },
  ])
}

export function checkAndPrompt(): void {
  checkForUpdate()
    .then((update) => {
      if (update) promptInstall(update)
    })
    .catch(() => {
      // Offline or rate-limited: updates are best effort.
    })
}

function showError(cause: unknown): void {
  Alert.alert('Update failed', cause instanceof Error ? cause.message : String(cause))
}
