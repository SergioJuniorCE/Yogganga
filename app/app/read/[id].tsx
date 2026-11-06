import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  getChapter,
  imageSource,
  saveProgress as saveProgressApi,
  type ChapterPayload,
} from '@/lib/api'
import { getLocalPages, removeChapter, saveChapter, useOfflineProgress } from '@/lib/offline'
import { chapterLabel, colors, spacing } from '@/lib/theme'

type ViewTokenLike = { index?: number }

function ReaderPage({ uri, width, onPress }: { uri: string; width: number; onPress: () => void }) {
  const [ratio, setRatio] = useState(0.72)

  return (
    <Pressable onPress={onPress}>
      <Image
        source={imageSource(uri)}
        style={{ width, aspectRatio: ratio, backgroundColor: colors.bg }}
        contentFit="contain"
        recyclingKey={uri}
        transition={100}
        onLoad={(event) => {
          const { width: loadedWidth, height: loadedHeight } = event.source
          if (loadedWidth > 0 && loadedHeight > 0) setRatio(loadedWidth / loadedHeight)
        }}
      />
    </Pressable>
  )
}

export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const progress = useOfflineProgress(id)
  const listRef = useRef<FlatList<string>>(null)

  const [payload, setPayload] = useState<ChapterPayload | null>(null)
  const [pages, setPages] = useState<string[]>([])
  const [local, setLocal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [chrome, setChrome] = useState(true)
  const [current, setCurrent] = useState(0)

  const pagesRef = useRef<string[]>([])
  const currentRef = useRef(0)
  const payloadRef = useRef<ChapterPayload | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    pagesRef.current = pages
  }, [pages])

  useEffect(() => {
    payloadRef.current = payload
  }, [payload])

  const flushProgress = useCallback((completed?: boolean) => {
    const data = payloadRef.current
    const total = pagesRef.current.length
    if (!data || total === 0) return
    const page = currentRef.current
    void saveProgressApi(data.chapter.id, page, total, completed ?? page >= total - 1).catch(() => {})
  }, [])

  const queueSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => flushProgress(), 1200)
  }, [flushProgress])

  const queueSaveRef = useRef(queueSave)
  useEffect(() => {
    queueSaveRef.current = queueSave
  }, [queueSave])

  // Save on the way out, whatever the reason (back button, chapter change, app kill).
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      flushProgress()
    },
    [flushProgress],
  )

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const localPages = await getLocalPages(id).catch(() => null)
    if (localPages && localPages.length > 0) {
      setPages(localPages)
      setLocal(true)
    }

    try {
      const data = await getChapter(id)
      setPayload(data)
      if (!localPages || localPages.length === 0) setPages(data.pages)
      setError(null)
    } catch (cause) {
      if (!localPages || localPages.length === 0) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (progress?.state === 'done') setLocal(true)
  }, [progress?.state])

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewTokenLike[] }) => {
    const first = viewableItems[0]
    if (!first || first.index == null) return
    currentRef.current = first.index
    setCurrent(first.index)
    queueSaveRef.current()
  }).current

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 40 }).current

  const onSave = async () => {
    if (!payload || pages.length === 0) return
    if (local) {
      await removeChapter(id)
      setLocal(false)
      return
    }
    if (progress?.state === 'running') return
    await saveChapter(id, payload.manga?.id ?? '', pages)
  }

  const go = (target: string | null) => {
    if (!target) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    flushProgress()
    router.replace(`/read/${target}`)
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  if (error || pages.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? 'No pages available for this chapter.'}</Text>
        <Pressable style={styles.retry} onPress={() => router.back()}>
          <Text style={styles.retryText}>Go back</Text>
        </Pressable>
      </View>
    )
  }

  const label = payload ? chapterLabel(payload.chapter) : 'Chapter'
  const saving = progress?.state === 'running'
  const resumeAt = Math.max(0, Math.min(payload?.progress?.page ?? 0, pages.length - 1))
  const estimatedPageHeight = width / 0.7

  return (
    <View style={styles.container}>
      <FlatList
        key={local ? 'local' : 'remote'}
        ref={listRef}
        data={pages}
        keyExtractor={(uri, index) => `${index}-${uri.slice(-16)}`}
        renderItem={({ item }) => (
          <ReaderPage uri={item} width={width} onPress={() => setChrome((value) => !value)} />
        )}
        initialScrollIndex={resumeAt > 0 ? resumeAt : undefined}
        getItemLayout={(_, index) => ({
          length: estimatedPageHeight,
          offset: estimatedPageHeight * index,
          index,
        })}
        onScrollToIndexFailed={(info) => {
          listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false })
          setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, animated: false }), 120)
        }}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        initialNumToRender={2}
        maxToRenderPerBatch={3}
        windowSize={5}
        removeClippedSubviews={false}
      />

      {chrome ? (
        <>
          <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
            <Pressable hitSlop={12} onPress={() => router.back()} accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </Pressable>
            <View style={styles.topTitle}>
              <Text numberOfLines={1} style={styles.title}>
                {label}
              </Text>
              {payload?.chapter.group ? (
                <Text numberOfLines={1} style={styles.group}>
                  {payload.chapter.group}
                </Text>
              ) : null}
            </View>
            <Pressable
              hitSlop={12}
              onPress={() => void onSave()}
              disabled={saving}
              accessibilityLabel={local ? 'Remove offline copy' : 'Save chapter offline'}
            >
              {saving ? (
                <Text style={styles.progressText}>
                  {progress?.done ?? 0}/{progress?.total ?? 0}
                </Text>
              ) : (
                <Ionicons
                  name={local ? 'trash-outline' : 'download-outline'}
                  size={21}
                  color={local ? colors.success : colors.text}
                />
              )}
            </Pressable>
          </View>

          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.sm }]}>
            <Pressable
              hitSlop={12}
              disabled={!payload?.prev}
              onPress={() => go(payload?.prev ?? null)}
              style={[styles.navButton, !payload?.prev && styles.navDisabled]}
            >
              <Ionicons name="chevron-back" size={18} color={colors.text} />
              <Text style={styles.navText}>Prev</Text>
            </Pressable>

            <Text style={styles.pageText}>
              {current + 1} / {pages.length}
            </Text>

            <Pressable
              hitSlop={12}
              disabled={!payload?.next}
              onPress={() => go(payload?.next ?? null)}
              style={[styles.navButton, !payload?.next && styles.navDisabled]}
            >
              <Text style={styles.navText}>Next</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.text} />
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    gap: spacing.lg,
    padding: spacing.xl,
  },
  errorText: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
  },
  retry: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 10,
  },
  retryText: {
    color: colors.text,
    fontWeight: '600',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: 'rgba(10,10,13,0.94)',
  },
  topTitle: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  group: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 1,
  },
  progressText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: 'rgba(10,10,13,0.94)',
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  navDisabled: {
    opacity: 0.3,
  },
  navText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  pageText: {
    color: colors.muted,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
})
