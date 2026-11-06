import { Ionicons } from '@expo/vector-icons'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import type { Chapter } from '@/lib/api'
import { chapterLabel, colors, spacing } from '@/lib/theme'

type Props = {
  chapter: Chapter
  onPress: () => void
  onDownload: () => void
}

export function ChapterRow({ chapter, onPress, onDownload }: Props) {
  const busy = chapter.status === 'queued' || chapter.status === 'downloading'
  const progress = chapter.progress
  const inProgress = progress && !progress.completed && progress.page > 0
  const percent = inProgress && progress.totalPages > 0 ? ((progress.page + 1) / progress.totalPages) * 100 : 0

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.info}>
        <View style={styles.labelRow}>
          {progress?.completed ? (
            <Ionicons name="checkmark-done" size={15} color={colors.success} />
          ) : null}
          <Text numberOfLines={1} style={styles.label}>
            {chapterLabel(chapter)}
          </Text>
        </View>
        <Text numberOfLines={1} style={styles.meta}>
          {[chapter.group, chapter.pages > 0 ? `${chapter.pages} pages` : null, chapter.language]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {inProgress ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${percent}%` as `${number}%` }]} />
          </View>
        ) : null}
      </View>

      {chapter.external ? (
        <Ionicons name="open-outline" size={18} color={colors.muted} />
      ) : busy ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : chapter.status === 'failed' ? (
        <Pressable onPress={onDownload} hitSlop={10} accessibilityLabel={`Retry ${chapterLabel(chapter)}`}>
          <Ionicons name="alert-circle-outline" size={20} color={colors.warning} />
        </Pressable>
      ) : chapter.downloaded ? (
        <Ionicons name="checkmark-circle" size={20} color={colors.success} />
      ) : (
        <Pressable onPress={onDownload} hitSlop={10} accessibilityLabel={`Download ${chapterLabel(chapter)}`}>
          <Ionicons name="download-outline" size={20} color={colors.muted} />
        </Pressable>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: {
    backgroundColor: colors.surface,
  },
  info: {
    flex: 1,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  label: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
    flexShrink: 1,
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
  },
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.surfaceAlt,
    marginTop: 6,
    overflow: 'hidden',
    maxWidth: 160,
  },
  fill: {
    height: 3,
    backgroundColor: colors.accent,
  },
})
