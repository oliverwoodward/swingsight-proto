import { Stack } from 'expo-router';

import { OnboardingDraftProvider } from '@/contexts/onboarding-draft';

export const unstable_settings = { initialRouteName: 'welcome' };

export default function OnboardingLayout() {
  return (
    <OnboardingDraftProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          // A single forward-moving flow; gestures stay enabled for back-nav.
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="welcome" />
        <Stack.Screen name="handedness" />
        <Stack.Screen name="view" />
        <Stack.Screen name="consent" />
      </Stack>
    </OnboardingDraftProvider>
  );
}
