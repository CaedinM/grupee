import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";

import {
  avatarUri,
  getEvent,
  getGroup,
  leaveGroup,
  type FestivalEvent,
  type Group,
  type GroupDetail,
  type User,
} from "../api";
import CodeBadge from "./CodeBadge";
import { styles } from "./styles";

const MEMBERS_POLL_MS = 5000;

export default function GroupView({
  user,
  group,
  onLeft,
}: {
  user: User;
  group: Group;
  onLeft: () => void;
}) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [event, setEvent] = useState<FestivalEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Groups made since event selection landed always have one; older test
  // groups may not, so the chip just stays hidden for those.
  useEffect(() => {
    if (!group.event_id) return;
    let cancelled = false;
    getEvent(group.event_id)
      .then((e) => {
        if (!cancelled) setEvent(e);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [group.event_id]);

  // Poll members so new joiners show up while this screen is open.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getGroup(group.id)
        .then((d) => {
          if (!cancelled) {
            setDetail(d);
            setError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        });
    load();
    const timer = setInterval(load, MEMBERS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [group.id]);

  const leave = async () => {
    try {
      await leaveGroup(group.id, user.id);
      onLeft();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <View style={styles.groupContainer}>
      <Text style={styles.title}>{group.name}</Text>
      {event && (
        <View style={styles.eventChip}>
          <Ionicons name="musical-notes" size={14} color="#8b8bf5" />
          <Text style={styles.eventChipText}>{event.name}</Text>
        </View>
      )}
      <CodeBadge code={group.code} groupName={group.name} />

      <Text style={styles.sectionHeader}>Members{detail ? ` (${detail.members.length})` : ""}</Text>
      <View style={styles.memberList}>
        {detail === null ? (
          <ActivityIndicator color="#5b5bf0" />
        ) : (
          detail.members.map((m) => (
            <View key={m.user_id} style={styles.memberRow}>
              {avatarUri(m.avatar_url) ? (
                <Image source={avatarUri(m.avatar_url)!} style={styles.memberAvatar} />
              ) : (
                <View style={[styles.memberAvatar, styles.memberAvatarEmpty]}>
                  <Ionicons name="person" size={16} color="#9a9aa5" />
                </View>
              )}
              <Text style={styles.memberName}>
                {m.display_name}
                {m.user_id === user.id ? " (you)" : ""}
              </Text>
              {m.role === "admin" && (
                <View style={styles.roleBadge}>
                  <Text style={styles.roleBadgeText}>admin</Text>
                </View>
              )}
            </View>
          ))
        )}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable style={styles.leaveButton} onPress={leave}>
        <Text style={styles.leaveText}>Leave group</Text>
      </Pressable>
    </View>
  );
}
