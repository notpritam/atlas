import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import { getSharedPayloads, clearSharedPayloads } from 'expo-sharing';
import { router } from 'expo-router';
import { enqueueAndroidShares } from '../../modules/foundkeep-shared/src/index.android.ts';
import FoundkeepShared from '../../modules/foundkeep-shared/src/index.android.ts';
import { useSession } from '../session/SessionProvider.tsx';

export function IncomingShares() {
  const { ready, account, client } = useSession();
  const processing = useRef(false);
  const warned = useRef(false);
  useEffect(() => {
    if (!ready) return;
    const receive = async () => {
      if (processing.current) return;
      const shares = getSharedPayloads(); if (!shares.length) return;
      if (!account) {
        if (!warned.current) { warned.current = true; Alert.alert('Sign in to save', 'Your shared items will be saved after you sign in.'); router.replace('/(auth)/sign-in'); }
        return;
      }
      processing.current = true;
      try {
        await enqueueAndroidShares(shares, account.id);
        // The queue now owns copies of every file. Never resolve remote previews.
        clearSharedPayloads(); warned.current = false;
        router.replace('/(app)/(tabs)/collection');
        await FoundkeepShared.retryPending(); client.invalidate();
      } catch (error) {
        Alert.alert('Shared items could not be saved', error instanceof Error ? error.message : 'Please try sharing again.', [
          {text:'Keep for retry',style:'cancel'}, {text:'Discard',style:'destructive',onPress:clearSharedPayloads},
        ]);
      } finally { processing.current = false; }
    };
    void receive();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void receive(); });
    return () => subscription.remove();
  }, [ready, account?.id, client]);
  return null;
}
