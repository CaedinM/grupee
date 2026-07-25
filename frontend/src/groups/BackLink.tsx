import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text } from "react-native";

import { color } from "../ui/theme";
import { styles } from "./styles";

export default function BackLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={styles.backLink} onPress={onPress} hitSlop={8}>
      <Ionicons name="chevron-back" size={16} color={color.accentSoft} />
      <Text style={styles.backText}>Back</Text>
    </Pressable>
  );
}
