import { Image } from 'expo-image'
import { imageSource } from '@/lib/api'
import { colors, radius } from '@/lib/theme'

type Props = {
  uri: string | null | undefined
  width: number
  radius?: number
}

export function Cover({ uri, width, radius: corner = radius.md }: Props) {
  return (
    <Image
      source={imageSource(uri)}
      style={{
        width,
        aspectRatio: 0.68,
        borderRadius: corner,
        backgroundColor: colors.surfaceAlt,
      }}
      contentFit="cover"
      transition={180}
      cachePolicy="memory-disk"
    />
  )
}
