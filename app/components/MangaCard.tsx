import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, radius, spacing } from '@/lib/theme'
import type { Manga } from '@/lib/api'
import { Cover } from './Cover'

type Props = {
  manga: Pick<Manga, 'title' | 'coverUrl'>
  width: number
  subtitle?: string
  onPress?: () => void
}

export function MangaCard({ manga, width, subtitle, onPress }: Props) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ width, opacity: pressed ? 0.7 : 1 }]}>
      <Cover uri={manga.coverUrl} width={width} />
      <Text numberOfLines={2} style={styles.title}>
        {manga.title}
      </Text>
      {subtitle ? (
        <Text numberOfLines={1} style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginTop: spacing.sm,
    lineHeight: 17,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 2,
  },
  badge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
})

export function CardBadge({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  )
}
