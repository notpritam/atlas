import { AdaptiveText as Text } from './AdaptiveText.tsx';
import { AdaptiveIcon as Ionicons } from './AdaptiveIcon.tsx';
import { router, Tabs } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Keyboard, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../session/SessionProvider.tsx';
import { colors } from '../theme.ts';
import { useMotionAllowed } from './motion.tsx';
import { GlassSurface } from './ScenicSurface.tsx';
import { createDockMotion, dockSpring } from './dockMotion.ts';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];
const DockContext = createContext({ collapsed: false, setCollapsed: (_value: boolean) => {}, bottomSpace: 100, height: 60 });

export function DockProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const { bottom } = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const height = fontScale >= 1.3 ? 84 : 60;
  // Reserve the expanded dock's height, including when it is hidden for typing.
  const bottomSpace = height + Math.max(bottom, 12) + 24;
  const value = useMemo(() => ({ collapsed, setCollapsed, bottomSpace, height }), [collapsed, bottomSpace, height]);
  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}
export const useDock = () => useContext(DockContext);

function useDockScreenReader() {
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isScreenReaderEnabled().then(value => { if (live) setScreenReader(value); }).catch(() => {});
    const reader = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => { live = false; reader.remove(); };
  }, []);
  return screenReader;
}

/** A floating tab bar: its absolute frame leaves the collection behind the glass. */
export function FloatingDock({ state, descriptors, navigation, insets }: TabBarProps) {
  const { collapsed, height } = useDock();
  const { width, fontScale } = useWindowDimensions();
  const { policy, updateRequired } = useSession();
  const screenReader = useDockScreenReader();
  const motion = useMotionAllowed();
  const [keyboard, setKeyboard] = useState(Keyboard.isVisible());
  const progress = useRef(new Animated.Value(0)).current;
  const stacked = fontScale >= 1.3;
  const compact = collapsed && state.routes[state.index]?.name === 'collection' && !stacked && !screenReader;
  const expandedWidth = Math.min(120, (width - insets.left - insets.right - 32 - 60 - 10 - 12) / 2);
  const { tabWidth, labelWidth, labelOpacity } = useMemo(() => createDockMotion(progress, expandedWidth), [progress, expandedWidth]);
  const canWrite = policy.capture.note && !updateRequired;

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboard(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(() => {
    // Only the two small tab widths animate, once at a scroll-state boundary.
    // No opacity is applied to the glass or any of its ancestors.
    if (!motion) { progress.stopAnimation(); progress.setValue(compact ? 1 : 0); return; }
    const animation = Animated.spring(progress, { ...dockSpring, toValue: compact ? 1 : 0 });
    animation.start();
    return () => animation.stop();
  }, [compact, motion, progress]);

  if (keyboard) return null;
  return <View testID="floating-dock" pointerEvents="box-none" style={[styles.frame, { bottom: Math.max(insets.bottom, 12), left: insets.left + 16, right: insets.right + 16 }]}>
    <GlassSurface testID="dock-material" style={[styles.surface, styles.tabs, { height }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const options = descriptors[route.key].options;
        const label = options.title || route.name;
        const gallery = route.name === 'collection';
        return <Animated.View key={route.key} style={{ width: tabWidth, height: height - 12 }}>
          <Pressable testID={`dock-${route.name}`} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: focused }} aria-selected={focused}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
            }}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            style={({ pressed }) => [styles.tab, stacked && styles.stacked, focused && styles.selected, pressed && styles.pressed]}>
            <Ionicons accessible={false} name={gallery ? focused ? 'grid' : 'grid-outline' : focused ? 'person-circle' : 'person-circle-outline'} size={24} color={focused ? colors.accent : colors.muted} />
            <Animated.View accessible={false} importantForAccessibility="no-hide-descendants" style={stacked ? undefined : { width: labelWidth, opacity: labelOpacity, overflow: 'hidden' }}>
              <Text numberOfLines={1} maxFontSizeMultiplier={2} style={[styles.label, !stacked && { width: expandedWidth - 44, paddingLeft: 8 }, focused && styles.selectedLabel]}>{label}</Text>
            </Animated.View>
          </Pressable>
        </Animated.View>;
      })}
    </GlassSurface>
    <GlassSurface interactive style={[styles.surface, styles.addSurface]}>
      <Pressable testID="dock-new-note" accessibilityRole="button" accessibilityLabel="Create a note" accessibilityState={{ disabled: !canWrite }} disabled={!canWrite} onPress={() => router.push('/(app)/new-note')} style={({ pressed }) => [styles.add, pressed && styles.pressed]}>
        <Ionicons accessible={false} name="add" size={28} color={canWrite ? colors.accent : colors.muted} />
      </Pressable>
    </GlassSurface>
  </View>;
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  surface: { borderRadius: 42, borderCurve: 'continuous', shadowColor: colors.shadow, shadowOffset: { width: 0, height: 6 }, shadowOpacity: .13, shadowRadius: 16, elevation: 6 },
  tabs: { flexDirection: 'row', alignItems: 'center', padding: 6 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 36 },
  stacked: { flexDirection: 'column', gap: 3 },
  selected: { backgroundColor: colors.accentSoft },
  pressed: { backgroundColor: colors.accentSoft },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, textAlign: 'center' },
  selectedLabel: { color: colors.accent },
  addSurface: { width: 60, height: 60 },
  add: { flex: 1, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
});
