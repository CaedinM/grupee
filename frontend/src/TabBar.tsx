import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { color, font, glass, radius, ramp, shadow } from "./ui/theme";

export type Tab = "groups" | "event" | "map" | "profile";

const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "groups", label: "Crew", icon: "people" },
  { key: "event", label: "Event", icon: "musical-notes" },
  { key: "map", label: "Map", icon: "map" },
  { key: "profile", label: "You", icon: "person" },
];

/** Dock padding + capsule height, i.e. everything above the safe-area inset. */
const TAB_BAR_BASE = 71;

/**
 * How much bottom padding a screen needs so its content clears the floating
 * bar. Every scrollable screen must apply this — the bar overlays content
 * rather than reserving a row, so nothing is kept clear automatically.
 */
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_BASE + Math.max(insets.bottom, 14);
}

/**
 * A floating glass capsule, overlaid on the screen stack rather than docked
 * into it (see the absolute layer in App.tsx). Content runs full-bleed to the
 * bottom of the display and the capsule hovers in front of it — which is the
 * point on the map, where the map now reaches the bottom edge.
 *
 * Because it overlays, it occludes: screens owe themselves
 * `useTabBarClearance()` of bottom padding, and the map's own bottom-anchored
 * controls are offset to sit above it.
 *
 * The moving part is one lozenge that springs between slots. It is the app's
 * loudest piece of motion, which is why the rest of the UI stays restrained.
 */
export default function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const insets = useSafeAreaInsets();
  // The lozenge is positioned in pixels, so it can't move until the bar has
  // been measured; before then it simply renders at slot 0 with zero width.
  const [slotWidth, setSlotWidth] = useState(0);
  const index = Math.max(0, TABS.findIndex((t) => t.key === tab));
  const slide = useRef(new Animated.Value(index)).current;

  const select = (key: Tab, i: number) => {
    Animated.spring(slide, {
      toValue: i,
      useNativeDriver: true,
      speed: 16,
      bounciness: 9,
    }).start();
    onChange(key);
  };

  return (
    <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 14) }]}>
      <View style={[styles.capsule, shadow.floating]}>
        <View style={styles.clip}>
          <BlurView
            intensity={64}
            tint="systemUltraThinMaterialDark"
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: glass.fill }]} />
          <LinearGradient colors={ramp.sheen} style={styles.sheen} pointerEvents="none" />
          <LinearGradient
            colors={ramp.specular}
            locations={[0, 0.38, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.specular}
            pointerEvents="none"
          />
          <View style={styles.hairline} pointerEvents="none" />

          <View
            style={styles.row}
            onLayout={(e) => setSlotWidth(e.nativeEvent.layout.width / TABS.length)}
          >
            {/* The travelling lozenge, behind the icons. */}
            <Animated.View
              style={[
                styles.lozenge,
                {
                  width: slotWidth - LOZENGE_INSET * 2,
                  transform: [
                    {
                      translateX: slide.interpolate({
                        inputRange: [0, 1],
                        outputRange: [LOZENGE_INSET, LOZENGE_INSET + slotWidth],
                      }),
                    },
                  ],
                },
              ]}
              pointerEvents="none"
            >
              <LinearGradient
                colors={ramp.accent}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[StyleSheet.absoluteFill, styles.lozengeFill]}
              />
              <LinearGradient
                colors={ramp.sheen}
                style={styles.lozengeSheen}
                pointerEvents="none"
              />
            </Animated.View>

            {TABS.map(({ key, label, icon }, i) => (
              <TabItem
                key={key}
                icon={icon}
                label={label}
                active={key === tab}
                onPress={() => select(key, i)}
              />
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

function TabItem({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const pop = useRef(new Animated.Value(1)).current;

  const press = () => {
    // A quick overshoot on the icon so the tap lands even before the lozenge
    // finishes travelling.
    Animated.sequence([
      Animated.spring(pop, { toValue: 0.86, useNativeDriver: true, speed: 60, bounciness: 0 }),
      Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 14 }),
    ]).start();
    onPress();
  };

  return (
    <Pressable style={styles.item} onPress={press} hitSlop={6}>
      <Animated.View style={{ transform: [{ scale: pop }], alignItems: "center", gap: 3 }}>
        <Ionicons
          name={active ? icon : (`${icon}-outline` as keyof typeof Ionicons.glyphMap)}
          size={21}
          color={active ? "#fff" : color.textFaint}
        />
        <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

const LOZENGE_INSET = 6;

const styles = StyleSheet.create({
  dock: {
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  capsule: {
    borderRadius: radius.pill,
  },
  clip: {
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  hairline: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.stroke,
  },
  sheen: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 30,
  },
  specular: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 1,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 9,
  },
  item: {
    flex: 1,
    alignItems: "center",
  },
  lozenge: {
    position: "absolute",
    top: LOZENGE_INSET,
    bottom: LOZENGE_INSET,
    left: 0,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  lozengeFill: {
    borderRadius: radius.pill,
  },
  lozengeSheen: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 18,
  },
  label: {
    fontFamily: font.sansMedium,
    fontSize: 10,
    letterSpacing: 0.3,
    color: color.textFaint,
  },
  labelActive: {
    fontFamily: font.sansSemi,
    color: "#fff",
  },
});
