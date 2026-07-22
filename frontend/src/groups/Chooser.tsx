import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from "react-native";

import {
  avatarUri,
  getGroup,
  type FestivalEvent,
  type Group,
  type GroupDetail,
} from "../api";
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
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.chooserContent,
        pastGroups.length === 0 && styles.chooserContentCentered,
      ]}
    >
      <Text style={styles.title}>Your crew</Text>
      <Text style={styles.subtitle}>Start a group or join one with a code.</Text>
      <Pressable style={styles.button} onPress={onCreate}>
        <Ionicons name="add-circle-outline" size={20} color="#fff" />
        <Text style={styles.buttonText}>Create a new group</Text>
      </Pressable>
      <Pressable style={[styles.button, styles.buttonSecondary]} onPress={onJoin}>
        <Ionicons name="enter-outline" size={20} color="#fff" />
        <Text style={styles.buttonText}>Join with a code</Text>
      </Pressable>

      {pastGroups.length > 0 && (
        <>
          <Text style={styles.sectionHeader}>My previous groups</Text>
          {pastGroups.map(({ group, event }) => (
            <PastGroupCard key={group.id} group={group} event={event} />
          ))}
        </>
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

  return (
    <View style={styles.pastCard}>
      <Text style={styles.pastGroupName}>{group.name}</Text>
      <View style={styles.pastEventRow}>
        <Ionicons name="musical-notes" size={14} color="#8b8bf5" />
        <Text style={styles.pastEventName}>{event.name}</Text>
      </View>
      {dates && <Text style={styles.pastDates}>{dates}</Text>}

      {detail === null ? (
        <ActivityIndicator color="#5b5bf0" style={styles.pastMembersLoading} />
      ) : (
        <View style={styles.pastMemberGrid}>
          {detail.members.map((m) => (
            <View key={m.user_id} style={styles.pastMember}>
              {avatarUri(m.avatar_url) ? (
                <Image source={avatarUri(m.avatar_url)!} style={styles.pastMemberAvatar} />
              ) : (
                <View style={[styles.pastMemberAvatar, styles.memberAvatarEmpty]}>
                  <Ionicons name="person" size={16} color="#9a9aa5" />
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
  );
}
