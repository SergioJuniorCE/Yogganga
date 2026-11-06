import { Ionicons } from '@expo/vector-icons'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { ChapterRow } from '@/components/ChapterRow'
import { Cover } from '@/components/Cover'
import {
  downloadChapter,
  follow,
  getManga,
  setDownloadMode,
  unfollow,
  type Chapter,
  type DownloadMode,
  type MangaDetails,
} from '@/lib/api'
import { chapterLabel, colors, radius, spacing } from '@/lib/theme'

const MODES: { value: DownloadMode; label: string }[] = [
  { value: 'new', label: 'New only' },
  { value: 'all', label: 'Everything' },
  { value: 'none', label: 'Nothing' },
]

export default function MangaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()

  const [details, setDetails] = useState<MangaDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (options: { spinner?: boolean; refresh?: boolean } = {}) => {
      if (!id) return
      if (options.spinner) setLoading(true)
      try {
        const result = await getManga(id, options.refresh)
        setDetails(result)
        setError(null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (options.spinner) setLoading(false)
      }
    },
    [id],
  )

  useEffect(() => {
    void load({ spinner: true })
  }, [load])

  // Refresh while the server has work queued for this series.
  const pending = useMemo(
    () =>
      details?.chapters.some(
        (chapter) => chapter.status === 'queued' || chapter.status === 'downloading',
      ) ?? false,
    [details],
  )

  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => void load(), 3000)
    return () => clearInterval(timer)
  }, [pending, load])

  const readingTarget = useMemo(() => {
    const chapters = details?.chapters ?? []
    const inProgress = chapters
      .filter((chapter) => chapter.progress && !chapter.progress.completed)
      .sort((a, b) => (b.progress?.updatedAt ?? 0) - (a.progress?.updatedAt ?? 0))[0]
    const nextUnread = chapters.find((chapter) => !chapter.progress?.completed)
    const target = inProgress ?? nextUnread ?? chapters[0]
    if (!target) return null

    if (inProgress) {
      return {
        chapter: inProgress,
        label: `Continue · ${chapterLabel(inProgress)} · p.${(inProgress.progress?.page ?? 0) + 1}`,
      }
    }
    if (nextUnread) return { chapter: nextUnread, label: `Start reading · ${chapterLabel(nextUnread)}` }
    return { chapter: target, label: `Read again · ${chapterLabel(target)}` }
  }, [details])

  const onToggleFollow = async () => {
    if (!id) return
    setBusy(true)
    try {
      if (details?.followed) await unfollow(id)
      else await follow(id, 'new')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const onChangeMode = async (mode: DownloadMode) => {
    if (!id) return
    setBusy(true)
    try {
      await setDownloadMode(id, mode)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const onDownload = async (chapter: Chapter) => {
    try {
      await downloadChapter(chapter.id)
      setDetails((current) =>
        current
          ? {
              ...current,
              chapters: current.chapters.map((item) =>
                item.id === chapter.id ? { ...item, status: 'queued' } : item,
              ),
            }
          : current,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: '' }} />
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  if (!details) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: '' }} />
        <Text style={styles.error}>{error ?? 'Could not load this series'}</Text>
        <Pressable style={styles.secondaryButton} onPress={() => void load({ spinner: true })}>
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    )
  }

  const { manga, chapters } = details
  const ordered = [...chapters].reverse()

  return (
    <>
      <Stack.Screen options={{ title: manga.title }} />
      <FlatList
        data={ordered}
        keyExtractor={(chapter) => chapter.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.coverRow}>
              <Cover uri={manga.coverUrl} width={112} />
              <View style={styles.identity}>
                <Text style={styles.title}>{manga.title}</Text>
                {manga.authors.length > 0 ? (
                  <Text style={styles.meta}>{manga.authors.join(', ')}</Text>
                ) : null}
                <Text style={styles.meta}>
                  {[manga.status, manga.year].filter(Boolean).join(' · ') || 'Unknown status'}
                </Text>
                {manga.tags.length > 0 ? (
                  <Text numberOfLines={2} style={styles.meta}>
                    {manga.tags.slice(0, 5).join(' · ')}
                  </Text>
                ) : null}
              </View>
            </View>

            {manga.description ? (
              <Text numberOfLines={4} style={styles.description}>
                {manga.description.replace(/\[[^\]]*\]\([^)]*\)/g, '')}
              </Text>
            ) : null}

            {readingTarget ? (
              <Pressable
                style={styles.readButton}
                onPress={() => router.push(`/read/${readingTarget.chapter.id}`)}
              >
                <Ionicons name="book-outline" size={17} color="#fff" />
                <Text numberOfLines={1} style={styles.readButtonText}>
                  {readingTarget.label}
                </Text>
              </Pressable>
            ) : null}

            {details.followed ? (
              <>
                <View style={styles.modes}>
                  {MODES.map((mode) => (
                    <Pressable
                      key={mode.value}
                      disabled={busy}
                      onPress={() => void onChangeMode(mode.value)}
                      style={[styles.chip, details.downloadMode === mode.value && styles.chipActive]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          details.downloadMode === mode.value && styles.chipTextActive,
                        ]}
                      >
                        {mode.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable disabled={busy} onPress={() => void onToggleFollow()}>
                  <Text style={styles.remove}>Remove from library</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                style={[styles.primaryButton, busy && { opacity: 0.6 }]}
                disabled={busy}
                onPress={() => void onToggleFollow()}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="add" size={18} color="#fff" />
                    <Text style={styles.primaryButtonText}>Add to library</Text>
                  </>
                )}
              </Pressable>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Text style={styles.chapterCount}>{chapters.length} chapters</Text>
          </View>
        }
        renderItem={({ item }) => (
          <ChapterRow
            chapter={item}
            onPress={() => router.push(`/read/${item.id}`)}
            onDownload={() => void onDownload(item)}
          />
        )}
        ListEmptyComponent={<Text style={styles.empty}>No chapters in your languages yet.</Text>}
      />
    </>
  )
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  list: {
    paddingBottom: 48,
  },
  header: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  coverRow: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  identity: {
    flex: 1,
    gap: 4,
    paddingTop: 2,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 26,
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  description: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
  },
  readButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    height: 46,
    paddingHorizontal: spacing.md,
  },
  readButtonText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 14,
    flexShrink: 1,
  },
  modes: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.accent,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    height: 44,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  remove: {
    color: colors.muted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: spacing.xs,
  },
  secondaryButton: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
  },
  secondaryButtonText: {
    color: colors.text,
    fontWeight: '600',
  },
  chapterCount: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  error: {
    color: colors.warning,
    fontSize: 13,
  },
  empty: {
    color: colors.muted,
    textAlign: 'center',
    padding: spacing.xl,
  },
})
