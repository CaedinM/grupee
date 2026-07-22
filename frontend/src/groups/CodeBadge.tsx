import { Ionicons } from "@expo/vector-icons";
import { Pressable, Share, Text, View } from "react-native";

import { styles } from "./styles";

export default function CodeBadge({
  code,
  groupName,
  big,
}: {
  code: string;
  groupName: string;
  big?: boolean;
}) {
  const share = () =>
    Share.share({
      message: `Join my crew "${groupName}" on WhereTheyAt with code ${code}`,
    }).catch(() => {});

  return (
    <Pressable style={[styles.codeBadge, big && styles.codeBadgeBig]} onPress={share}>
      <Text style={[styles.codeText, big && styles.codeTextBig]}>{code}</Text>
      <View style={styles.codeShareRow}>
        <Ionicons name="share-outline" size={14} color="#8b8bf5" />
        <Text style={styles.codeShareHint}>tap to share</Text>
      </View>
    </Pressable>
  );
}
