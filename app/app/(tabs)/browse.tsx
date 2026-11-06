import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { EmptyState } from '@/components/EmptyState'
import { MangaCard } from '@/components/MangaCard'
import { search, type Manga } from '@/lib/api'
import { colors, radius, spacing } from '@/lib/theme'

export default function BrowseScreen() {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const cardWidth = (width - spacing.lg * 2 - spacing.md) / 2

  const [query, setQuery] = useState('')
  const [items, setItems] = useState<Manga[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setItems([])
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const result = await search(trimmed)
        if (cancelled) return
        setItems(result.items)
        setError(null)
      } catch (cause) {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 450)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  return (
    <View style={styles.container}>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search MangaDex"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.input}
        />
        {loading ? <ActivityIndicator size="small" color={colors.accent} /> : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md }}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          query.trim().length >= 2 && !loading ? (
            <EmptyState icon="search-outline" title="Nothing found" message="Try another title or a romanized name." />
          ) : undefined
        }
        renderItem={({ item }) => (
          <MangaCard
            manga={item}
            width={cardWidth}
            subtitle={[item.status, item.year].filter(Boolean).join(' · ')}
            onPress={() => router.push(`/manga/${item.id}`)}
          />
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    height: '100%',
  },
  error: {
    color: colors.warning,
    fontSize: 13,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  list: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: 40,
  },
})
