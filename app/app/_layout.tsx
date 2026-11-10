import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { LoginScreen } from '@/components/LoginScreen'
import { SessionProvider, useSession } from '@/lib/session'
import { colors } from '@/lib/theme'
import { checkAndPrompt } from '@/lib/updates'

function Root() {
  const { status } = useSession()

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  if (status === 'signedOut') return <LoginScreen />

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="manga/[id]" options={{ title: '' }} />
      <Stack.Screen name="read/[id]" options={{ headerShown: false }} />
    </Stack>
  )
}

export default function RootLayout() {
  useEffect(checkAndPrompt, [])

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="light" />
        <Root />
      </SessionProvider>
    </SafeAreaProvider>
  )
}
