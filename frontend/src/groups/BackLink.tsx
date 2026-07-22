import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text } from "react-native";

import { styles } from "./styles";

export default function BackLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={styles.backLink} onPress={onPress} hitSlop={8}>
      <Ionicons name="chevron-back" size={18} color="#8b8bf5" />
      <Text style={styles.backText}>Back</Text>
    </Pressable>
  );
}
