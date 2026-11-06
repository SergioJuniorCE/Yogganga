import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { EmptyState } from '@/components/EmptyState'
import { Cover } from '@/components/Cover'
import { MangaCard } from '@/components/MangaCard'
import { getHistory, getLibrary, type HistoryItem, type LibraryItem, type Stats } from '@/lib/api'
import { chapterLabel, colors, radius, spacing } from '@/lib/theme'

export default function LibraryScreen() {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const cardWidth = (width - spacing.lg * 2 - spacing.md) / 2

  const [items, setItems] = useState<LibraryItem[]>([])
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const [library, recent] = await Promise.all([getLibrary(), getHistory(12)])
      setItems(library.items)
      setStats(library.stats)
      setHistory(recent.items)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const onRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      numColumns={2}
      columnWrapperStyle={{ gap: spacing.md }}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          {stats ? (
            <Text style={styles.stats}>
              {stats.series} series · {stats.downloaded} of {stats.chapters} chapters on the server
              {stats.queued > 0 ? ` · ${stats.queued} in queue` : ''}
            </Text>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {history.length > 0 ? (
            <View style={styles.continueBlock}>
              <Text style={styles.sectionTitle}>Continue reading</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.continueList}
              >
                {history.map((item) => {
                  const percent =
                    item.totalPages > 0 ? Math.min(100, ((item.page + 1) / item.totalPages) * 100) : 0
                  return (
                    <Pressable
                      key={`${item.chapter.id}-${item.updatedAt}`}
                      onPress={() => router.push(`/read/${item.chapter.id}`)}
                      style={({ pressed }) => [styles.continueCard, pressed && { opacity: 0.7 }]}
                    >
                      <Cover uri={item.manga.coverUrl} width={46} radius={6} />
                      <View style={styles.continueInfo}>
                        <Text numberOfLines={1} style={styles.continueTitle}>
                          {item.manga.title}
                        </Text>
                        <Text numberOfLines={1} style={styles.continueChapter}>
                          {chapterLabel(item.chapter)}
                        </Text>
                        <Text style={styles.continueMeta}>
                          {item.completed ? 'Finished' : `Page ${item.page + 1} of ${item.totalPages}`}
                        </Text>
                        <View style={styles.track}>
                          <View
                            style={[
                              styles.fill,
                              { width: `${item.completed ? 100 : percent}%` as `${number}%` },
                            ]}
                          />
                        </View>
                      </View>
                    </Pressable>
                  )
                })}
              </ScrollView>
            </View>
          ) : null}

          {items.length > 0 ? <Text style={styles.sectionTitle}>Your library</Text> : null}
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          icon="library-outline"
          title="Library is empty"
          message="Search MangaDex on the Browse tab and follow a series. New chapters download on your server automatically."
        />
      }
      renderItem={({ item }) => (
        <MangaCard
          manga={item}
          width={cardWidth}
          subtitle={
            item.continueReading
              ? `${chapterLabel(item.continueReading.chapter)} · p.${item.continueReading.page + 1}`
              : item.nextChapter
                ? `Start ${chapterLabel(item.nextChapter)}`
                : `${item.readCount}/${item.chapterCount} read`
          }
          onPress={() => router.push(`/manga/${item.id}`)}
        />
      )}
    />
  )
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: 40,
  },
  header: {
    gap: spacing.sm,
  },
  stats: {
    color: colors.muted,
    fontSize: 13,
  },
  error: {
    color: colors.warning,
    fontSize: 13,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: spacing.md,
  },
  continueBlock: {
    gap: spacing.xs,
  },
  continueList: {
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingRight: spacing.lg,
  },
  continueCard: {
    width: 232,
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  continueInfo: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  continueTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  continueChapter: {
    color: colors.muted,
    fontSize: 11,
  },
  continueMeta: {
    color: colors.muted,
    fontSize: 10,
  },
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.surfaceAlt,
    marginTop: 4,
    overflow: 'hidden',
  },
  fill: {
    height: 3,
    backgroundColor: colors.accent,
  },
})
