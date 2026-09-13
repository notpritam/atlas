import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import { router } from 'expo-router';
import { enqueueAndroidShares } from '../../modules/foundkeep-shared/src/index.android.ts';
import FoundkeepShared from '../../modules/foundkeep-shared/src/index.android.ts';
import AndroidShares from '../../modules/foundkeep-shared/src/androidShares.ts';
import { createIncomingReceiptDrain } from './incomingReceipts.ts';
import { useSession } from '../session/SessionProvider.tsx';

export function IncomingShares() {
  const { ready, account, client } = useSession();
  const latest = useRef({ ready, account, client }); latest.current = { ready, account, client };
  const warned = useRef(false);
  const drain = useRef<ReturnType<typeof createIncomingReceiptDrain> | null>(null);
  if (!drain.current) drain.current = createIncomingReceiptDrain({
    pending: () => AndroidShares.pendingReceipts(),
    acknowledge: id => AndroidShares.acknowledgeReceipt(id),
    owner: () => latest.current.ready ? latest.current.account?.id || null : null,
    enqueue: enqueueAndroidShares,
    async afterSaved() {
      warned.current = false; router.replace('/(app)/(tabs)/collection');
      await FoundkeepShared.retryPending(); latest.current.client.invalidate();
    },
    signedOut() {
      if (!latest.current.ready || warned.current) return;
      warned.current = true;
      Alert.alert('Sign in to save', 'Your shared items will be saved after you sign in.');
      router.replace('/(auth)/sign-in');
    },
    failed(error, discard) {
      Alert.alert('Shared items could not be saved', error instanceof Error ? error.message : 'Please try sharing again.', [
        {text:'Keep for retry',style:'cancel'}, {text:'Discard',style:'destructive',onPress:()=>void discard().catch(()=>{})},
      ]);
    },
  });
  useEffect(() => {
    const receive = () => { void drain.current!.notify().catch(() => {}); };
    receive();
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') receive(); });
    const incoming = AndroidShares.addListener('onIncomingShare', receive);
    return () => { foreground.remove(); incoming.remove(); };
  }, [ready, account?.id]);
  return null;
}
