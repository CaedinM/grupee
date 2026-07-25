import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, ScrollView, Text, View } from "react-native";

import {
  avatarUri,
  getGroup,
  type FestivalEvent,
  type Group,
  type GroupDetail,
} from "../api";
import { useTabBarClearance } from "../TabBar";
import { GlassButton, GlassSurface, Reveal } from "../ui/Glass";
import { color, radius, space, type } from "../ui/theme";
import { formatEventDates, type PastGroup } from "./events";
import { styles } from "./styles";

export default function Chooser({
  onCreate,
  onJoin,
  pastGroups,
}: {
  onCreate: () => void;
  onJoin: () => void;
  pastGroups: PastGroup[];
}) {
  const clearance = useTabBarClearance();
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.chooserContent,
        pastGroups.length === 0 && styles.chooserContentCentered,
        { paddingBottom: clearance + space.lg },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Reveal>
        <Text style={styles.eyebrow}>Nobody yet</Text>
        <Text style={type.hero}>Find your crew</Text>
        <Text style={[styles.subtitle, { marginTop: space.sm }]}>
          Start a group, or drop in with a four-letter code.
        </Text>
      </Reveal>

      <Reveal delay={90} style={{ gap: space.md, marginTop: space.md }}>
        <GlassButton
          label="Create a new group"
          onPress={onCreate}
          icon={<Ionicons name="add-circle" size={19} color="#fff" />}
        />
        <GlassButton
          label="Join with a code"
          variant="glass"
          onPress={onJoin}
          icon={<Ionicons name="enter-outline" size={19} color={color.text} />}
        />
      </Reveal>

      {pastGroups.length > 0 && (
        <Reveal delay={170} style={{ marginTop: space.lg }}>
          <Text style={styles.sectionHeader}>My previous groups</Text>
          {pastGroups.map(({ group, event }) => (
            <PastGroupCard key={group.id} group={group} event={event} />
          ))}
        </Reveal>
      )}
    </ScrollView>
  );
}

/**
 * One finished festival. Members are fetched per card — history is short and
 * only rendered on the chooser, so the extra requests stay cheap.
 */
function PastGroupCard({ group, event }: { group: Group; event: FestivalEvent }) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    getGroup(group.id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [group.id]);

  const dates = formatEventDates(event.starts_at, event.ends_at);

  // History is over, so it sits back: a dimmer pane than anything live.
  return (
    <GlassSurface r={radius.lg} intensity={32} style={styles.pastCard}>
      <View style={styles.pastBody}>
        <Text style={styles.pastGroupName}>{group.name}</Text>
        <View style={styles.pastEventRow}>
          <Ionicons name="musical-notes" size={12} color={color.accentSoft} />
          <Text style={styles.pastEventName}>{event.name}</Text>
        </View>
        {dates && <Text style={styles.pastDates}>{dates}</Text>}

        {detail === null ? (
          <ActivityIndicator color={color.accentSoft} style={styles.pastMembersLoading} />
        ) : (
          <View style={styles.pastMemberGrid}>
            {detail.members.map((m) => (
              <View key={m.user_id} style={styles.pastMember}>
                {avatarUri(m.avatar_url) ? (
                  <Image source={avatarUri(m.avatar_url)!} style={styles.pastMemberAvatar} />
                ) : (
                  <View style={[styles.pastMemberAvatar, styles.memberAvatarEmpty]}>
                    <Ionicons name="person" size={16} color={color.textFaint} />
                  </View>
                )}
                <Text style={styles.pastMemberName} numberOfLines={1}>
                  {m.display_name}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </GlassSurface>
  );
}
