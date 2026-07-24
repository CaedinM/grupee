import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type Tab = "groups" | "event" | "map" | "profile";

const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "groups", label: "My Group", icon: "people" },
  { key: "event", label: "My Event", icon: "calendar" },
  { key: "map", label: "Map", icon: "map" },
  { key: "profile", label: "Profile", icon: "person-circle" },
];

export default function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {TABS.map(({ key, label, icon }) => {
        const active = key === tab;
        return (
          <Pressable key={key} style={styles.item} onPress={() => onChange(key)} hitSlop={4}>
            <Ionicons
              name={active ? icon : (`${icon}-outline` as keyof typeof Ionicons.glyphMap)}
              size={24}
              color={active ? "#5b5bf0" : "#71717c"}
            />
            <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: "#16161b",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#2a2a32",
    paddingTop: 10,
  },
  item: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  label: {
    fontSize: 11,
    color: "#71717c",
  },
  labelActive: {
    color: "#5b5bf0",
    fontWeight: "600",
  },
});
