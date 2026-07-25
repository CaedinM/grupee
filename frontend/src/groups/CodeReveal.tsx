import { Text, View } from "react-native";

import { type Group } from "../api";
import { useTabBarClearance } from "../TabBar";
import { GlassButton, Reveal } from "../ui/Glass";
import { type as type_ } from "../ui/theme";
import CodeBadge from "./CodeBadge";
import { styles } from "./styles";

export default function CodeReveal({
  group,
  onContinue,
}: {
  group: Group;
  onContinue: () => void;
}) {
  const clearance = useTabBarClearance();
  return (
    <View style={[styles.card, { paddingBottom: clearance }]}>
      <Reveal>
        <Text style={styles.eyebrow}>Crew created</Text>
        <Text style={type_.hero}>{group.name}</Text>
        <Text style={[styles.subtitle, { marginTop: 8 }]}>
          Share this code and your crew is on the map.
        </Text>
      </Reveal>
      <Reveal delay={140}>
        <CodeBadge code={group.code} groupName={group.name} big />
      </Reveal>
      <Reveal delay={260}>
        <GlassButton label="Continue" onPress={onContinue} />
      </Reveal>
    </View>
  );
}
