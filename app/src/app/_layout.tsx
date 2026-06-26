// Polyfills must load before any app code that uses crypto/URL (Supabase, uuid).
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';

import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/contexts/auth';
import { ProfileProvider } from '@/contexts/profile';
import {
  createSupabaseProfileStore,
  secureStoreProfile,
  type ProfileStore,
} from '@/services/profile-store';
import { createId } from '@/utils/id';

/**
 * Selects the profile store + id minter from the auth state, then mounts the
 * ProfileProvider. When the backend is configured we use the Supabase store and
 * set the profile id = anonymous `auth.uid()`; otherwise we fall back to the
 * Phase-1 device-local store so the app runs pre-provisioning. We wait for the
 * anonymous session before mounting (configured case) so the Supabase store
 * always queries under a valid session.
 */
function ProfileBootstrap({ children }: { children: ReactNode }) {
  const { userId, isReady, isConfigured } = useAuth();

  const store = useMemo<ProfileStore>(
    () => (isConfigured ? createSupabaseProfileStore() : secureStoreProfile),
    [isConfigured],
  );

  const mintId = useCallback(
    () => (isConfigured && userId ? userId : createId()),
    [isConfigured, userId],
  );

  // Hold the tree until the anonymous session is established (native splash stays up).
  if (isConfigured && !isReady) return null;

  return (
    <ProfileProvider store={store} mintId={mintId}>
      {children}
    </ProfileProvider>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
          <AuthProvider>
            <ProfileBootstrap>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="(onboarding)" />
                <Stack.Screen name="capture" options={{ presentation: 'fullScreenModal' }} />
                {/* Processing replaces capture; no back-swipe so the user can't pop into a
                    half-uploaded camera state. The report is a normal card screen. */}
                <Stack.Screen name="processing" options={{ gestureEnabled: false }} />
                <Stack.Screen name="report/[id]" />
                <Stack.Screen name="history" />
                <Stack.Screen name="privacy" options={{ presentation: 'modal' }} />
              </Stack>
              <StatusBar style="auto" />
            </ProfileBootstrap>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
