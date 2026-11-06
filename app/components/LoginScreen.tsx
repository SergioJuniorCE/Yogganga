import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useSession } from '@/lib/session'
import { colors, radius, spacing } from '@/lib/theme'

export function LoginScreen() {
  const { serverUrl, signIn, signUp } = useSession()
  const insets = useSafeAreaInsets()

  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [url, setUrl] = useState(serverUrl)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (busy) return
    if (!url.trim()) return setError('Enter your server address.')
    if (!username.trim()) return setError('Enter a username.')
    if (!password) return setError('Enter a password.')

    setBusy(true)
    setError(null)
    try {
      if (mode === 'signin') await signIn(url, username.trim(), password)
      else await signUp(url, username.trim(), password, invite.trim())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Ionicons name="book-outline" size={28} color={colors.accent} />
          </View>
          <Text style={styles.title}>Yogganga</Text>
          <Text style={styles.subtitle}>
            {mode === 'signin' ? 'Sign in to your library' : 'Create an account on your server'}
          </Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Server</Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="http://192.168.1.20:8787"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
          />

          <Text style={styles.label}>Username</Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder="owner"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="username"
            style={styles.input}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="At least 8 characters"
            placeholderTextColor={colors.muted}
            secureTextEntry
            autoCapitalize="none"
            textContentType={mode === 'signin' ? 'password' : 'newPassword'}
            style={styles.input}
            onSubmitEditing={() => void submit()}
          />

          {mode === 'signup' ? (
            <>
              <Text style={styles.label}>Invite code</Text>
              <TextInput
                value={invite}
                onChangeText={setInvite}
                placeholder="From the server owner"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
            </>
          ) : null}

          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={16} color={colors.warning} />
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            style={[styles.primaryButton, busy && { opacity: 0.6 }]}
            onPress={() => void submit()}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              setError(null)
            }}
            style={styles.switchButton}
          >
            <Text style={styles.switchText}>
              {mode === 'signin' ? 'Need an account? Create one' : 'Already have an account? Sign in'}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.footer}>
          Your server keeps the library. Everyone signed in shares the downloads, but follows and reading
          progress are your own.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
  },
  brand: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  logo: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
  },
  form: {
    gap: spacing.sm,
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    height: 46,
    color: colors.text,
    fontSize: 15,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
  },
  error: {
    color: colors.warning,
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  switchButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  switchText: {
    color: colors.muted,
    fontSize: 13,
  },
  footer: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: spacing.xl,
    opacity: 0.8,
  },
})
