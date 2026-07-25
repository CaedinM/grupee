import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Animated, Pressable, Share, Text, View } from "react-native";

import { GlassSurface, usePressScale } from "../ui/Glass";
import { color, radius } from "../ui/theme";
import { styles } from "./styles";

/**
 * The join code, as a monolithic pane of glass. `big` is the post-creation
 * reveal: full width, mono at 54pt, with the accent bleeding up from the
 * bottom edge so the code reads as lit from within.
 */
export default function CodeBadge({
  code,
  groupName,
  big,
}: {
  code: string;
  groupName: string;
  big?: boolean;
}) {
  const { scale, onPressIn, onPressOut } = usePressScale(big ? 0.97 : 0.94);

  const share = () =>
    Share.share({
      message: `Join my crew "${groupName}" on WhereTheyAt with code ${code}`,
    }).catch(() => {});

  return (
    <Animated.View style={[{ transform: [{ scale }] }, big && styles.codeBadgeBig]}>
      <Pressable onPress={share} onPressIn={onPressIn} onPressOut={onPressOut}>
        <GlassSurface
          r={big ? radius.xl : radius.md}
          intensity={big ? 56 : 40}
          raised={big}
          style={big ? undefined : styles.codeBadge}
        >
          {big && (
            <LinearGradient
              colors={["rgba(110,107,255,0)", "rgba(168,85,247,0.28)"]}
              style={[
                { position: "absolute", left: 0, right: 0, bottom: 0, height: 150 },
              ]}
              pointerEvents="none"
            />
          )}
          <View style={[styles.codeBody, big && styles.codeBodyBig]}>
            <Text style={[styles.codeText, big && styles.codeTextBig]}>{code}</Text>
            <View style={styles.codeShareRow}>
              <Ionicons name="share-outline" size={12} color={color.accentSoft} />
              <Text style={styles.codeShareHint}>TAP TO SHARE</Text>
            </View>
          </View>
        </GlassSurface>
      </Pressable>
    </Animated.View>
  );
}
