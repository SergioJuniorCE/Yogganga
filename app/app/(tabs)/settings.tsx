import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { getStats, refreshLibrary, type Stats } from '@/lib/api'
import { clearOffline, offlineStats } from '@/lib/offline'
import { useSession } from '@/lib/session'
import { colors, radius, spacing } from '@/lib/theme'

function bytesToHuman(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export default function SettingsScreen() {
  const { user, serverUrl, signOut } = useSession()

  const [stats, setStats] = useState<Stats | null>(null)
  const [offline, setOffline] = useState({ chapters: 0, bytes: 0 })
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const loadStats = useCallback(async () => {
    try {
      setStats(await getStats())
    } catch {
      setStats(null)
    }
    setOffline(await offlineStats().catch(() => ({ chapters: 0, bytes: 0 })))
  }, [])

  useFocusEffect(
    useCallback(() => {
      void loadStats()
    }, [loadStats]),
  )

  const checkForChapters = async () => {
    setRefreshing(true)
    setMessage(null)
    try {
      const result = await refreshLibrary()
      setMessage({
        ok: true,
        text: `Checked ${result.series} series · ${result.added} new · ${result.queued} queued`,
      })
      await loadStats()
    } catch (cause) {
      setMessage({ ok: false, text: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setRefreshing(false)
    }
  }

  const clearCache = () => {
    Alert.alert('Delete offline chapters?', 'Chapters saved to this phone will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await clearOffline()
          await loadStats()
        },
      },
    ])
  }

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'Reading progress stays on the server.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ])
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.sectionTitle}>Account</Text>
      <View style={styles.card}>
        <Row label="Signed in as" value={user?.username ?? 'Unknown'} />
        <Row label="Server" value={serverUrl.replace(/^https?:\/\//, '')} />
        <Pressable style={styles.secondaryButton} onPress={confirmSignOut}>
          <Text style={[styles.secondaryButtonText, { color: colors.warning }]}>Sign out</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>Library</Text>
      <View style={styles.card}>
        {stats ? (
          <>
            <Row label="Followed series" value={String(stats.series)} />
            <Row label="Chapters tracked" value={String(stats.chapters)} />
            <Row label="Downloaded" value={String(stats.downloaded)} />
            <Row label="Queue" value={String(stats.queued)} />
            {stats.failed > 0 ? <Row label="Failed" value={String(stats.failed)} /> : null}
          </>
        ) : (
          <Text style={styles.muted}>Could not reach the server.</Text>
        )}

        <Pressable style={styles.secondaryButton} onPress={checkForChapters} disabled={refreshing}>
          {refreshing ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Text style={styles.secondaryButtonText}>Check for new chapters</Text>
          )}
        </Pressable>

        {message ? (
          <View style={styles.statusRow}>
            <Ionicons
              name={message.ok ? 'checkmark-circle' : 'alert-circle'}
              size={16}
              color={message.ok ? colors.success : colors.warning}
            />
            <Text style={[styles.statusText, { color: message.ok ? colors.success : colors.warning }]}>
              {message.text}
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.sectionTitle}>On this phone</Text>
      <View style={styles.card}>
        <Row label="Saved chapters" value={String(offline.chapters)} />
        <Row label="Storage used" value={bytesToHuman(offline.bytes)} />
        <Pressable style={styles.secondaryButton} onPress={clearCache}>
          <Text style={[styles.secondaryButtonText, { color: colors.warning }]}>Delete offline chapters</Text>
        </Pressable>
      </View>

      <Text style={styles.footer}>
        Metadata and chapter images come from MangaDex. Support the creators by buying the volumes you love.
      </Text>
    </ScrollView>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.rowValue}>
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.sm,
    paddingBottom: 48,
  },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  secondaryButton: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  secondaryButtonText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 14,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
  },
  statusText: {
    fontSize: 13,
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 4,
  },
  rowLabel: {
    color: colors.muted,
    fontSize: 14,
  },
  rowValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  muted: {
    color: colors.muted,
    fontSize: 13,
  },
  footer: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
})
