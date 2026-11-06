export const colors = {
  bg: '#0a0a0d',
  surface: '#141419',
  surfaceAlt: '#1c1c23',
  border: '#272733',
  text: '#f3f3f6',
  muted: '#8b8b9a',
  accent: '#e8434a',
  accentDim: '#3a1a1d',
  success: '#3ecf8e',
  warning: '#f0b429',
}

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
}

export function chapterLabel(chapter: { chapter: string | null; volume: string | null; title: string | null }): string {
  const number = chapter.chapter?.trim()
  if (number) {
    return chapter.volume ? `Chapter ${number} · Vol. ${chapter.volume}` : `Chapter ${number}`
  }
  return chapter.title?.trim() || 'Oneshot'
}
