import { Pressable, Text, View } from "react-native";

import { type Group } from "../api";
import CodeBadge from "./CodeBadge";
import { styles } from "./styles";

export default function CodeReveal({
  group,
  onContinue,
}: {
  group: Group;
  onContinue: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{group.name} is live</Text>
      <Text style={styles.subtitle}>Share this code so your crew can join:</Text>
      <CodeBadge code={group.code} groupName={group.name} big />
      <Pressable style={styles.button} onPress={onContinue}>
        <Text style={styles.buttonText}>Continue</Text>
      </Pressable>
    </View>
  );
}
