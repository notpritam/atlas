import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import type { FoundkeepClient } from '../api/client.ts';

export type NotificationState = 'on' | 'off' | 'blocked' | 'unavailable';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function projectId() {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const value = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  return typeof value === 'string' && value ? value : null;
}

async function deviceToken() {
  if (!Device.isDevice) throw new Error('Notifications require a physical device.');
  const id = projectId();
  if (!id) throw new Error('Notifications will be available after FoundKeep finishes its App Store setup.');
  return (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
}

export async function notificationState(client: FoundkeepClient): Promise<NotificationState> {
  if (!Device.isDevice) return 'unavailable';
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && !permission.canAskAgain) return 'blocked';
  const remote = await client.notificationStatus();
  if (!remote.enabled) return 'off';
  return permission.granted ? 'on' : 'blocked';
}

/** Called only from a customer gesture in Settings, so the iOS permission
 * prompt never appears during onboarding or app launch. */
export async function enableNotifications(client: FoundkeepClient): Promise<void> {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: 'Saved items', importance: Notifications.AndroidImportance.DEFAULT });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } });
  }
  if (!permission.granted) throw new Error('Allow notifications in device Settings to receive capture-ready alerts.');
  await client.registerNotifications(await deviceToken());
}

export async function disableNotifications(client: FoundkeepClient): Promise<void> {
  await client.unregisterNotifications();
}

/** Refresh a previously enabled device token without prompting. Token refresh
 * failures never block collection access or sharing. */
export async function syncNotificationRegistration(client: FoundkeepClient, enabled = true): Promise<void> {
  const remote = await client.notificationStatus();
  if (!remote.enabled) return;
  if (!enabled) {
    await client.unregisterNotifications();
    return;
  }
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    await client.unregisterNotifications();
    return;
  }
  await client.registerNotifications(await deviceToken());
}

export function notificationLink(response: Notifications.NotificationResponse | null | undefined): string | null {
  const value = response?.notification.request.content.data?.url;
  return typeof value === 'string' ? value : null;
}
