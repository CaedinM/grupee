import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from "react-native";

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
import { landmarksContaining } from "../geo";
import { useTabBarClearance } from "../TabBar";
import { GlassSurface, Reveal } from "../ui/Glass";
import { color, radius, space, type } from "../ui/theme";
import { useEventLandmarks } from "../useEventLandmarks";
import type { EventLiveness } from "../useEventLiveness";
import { useGroupLocations } from "../useGroupLocations";
import CodeBadge from "./CodeBadge";
import { styles } from "./styles";

const MEMBERS_POLL_MS = 5000;

export default function GroupView({
  user,
  group,
  liveness,
  onLeft,
}: {
  user: User;
  group: Group;
  liveness: EventLiveness;
  onLeft: () => void;
}) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [event, setEvent] = useState<FestivalEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clearance = useTabBarClearance();

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

  // Member positions + the event's landmarks let us tag each member with the
  // landmark they're standing in. Locations only stream while the event is
  // live, matching the map; nobody's tagged between festivals. Landmarks are
  // already scoped to this group's event.
  const live = liveness.status === "live";
  const { members: memberLocations } = useGroupLocations(live ? group.id : null);
  const landmarks = useEventLandmarks(group.event_id ?? null);

  const landmarkByUser = new Map<string, string>();
  for (const ml of memberLocations) {
    if (!ml.location) continue;
    const inside = landmarksContaining(landmarks, {
      latitude: ml.location.lat,
      longitude: ml.location.lng,
    });
    if (inside.length > 0) {
      landmarkByUser.set(ml.user_id, inside.map((l) => l.name).join(", "));
    }
  }

  // The group's creator is the member holding the "admin" membership role
  // (assigned server-side to whoever created the group; joiners are "member").
  const creator = detail?.members.find((m) => m.role === "admin") ?? null;

  const leave = async () => {
    try {
      await leaveGroup(group.id, user.id);
      onLeft();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <View style={[styles.groupContainer, { paddingBottom: clearance }]}>
      <Reveal>
        <Text style={styles.eyebrow}>Your crew</Text>
        <Text style={type.hero} numberOfLines={2}>
          {group.name}
        </Text>
        {creator && (
          <Text style={[styles.subtitle, { marginTop: space.xs, fontSize: 14 }]} numberOfLines={1}>
            Started by {creator.display_name}
            {creator.user_id === user.id ? " (you)" : ""}
          </Text>
        )}
      </Reveal>

      <Reveal delay={70} style={styles.metaRow}>
        {event && (
          <GlassSurface
            r={radius.pill}
            intensity={36}
            sheen={false}
            style={styles.eventChip}
          >
            <View style={styles.eventChipBody}>
              <Ionicons name="musical-notes" size={13} color={color.accentSoft} />
              <Text style={styles.eventChipText}>{event.name}</Text>
            </View>
          </GlassSurface>
        )}
        <CodeBadge code={group.code} groupName={group.name} />
      </Reveal>

      <Reveal delay={130} style={styles.memberSection}>
        <Text style={styles.sectionHeader}>
          Members{detail ? ` · ${detail.members.length}` : ""}
        </Text>
        <GlassSurface r={radius.lg} style={styles.memberList}>
          {detail === null ? (
            <View style={styles.memberLoading}>
              <ActivityIndicator color={color.accentSoft} />
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.memberListBody}
              showsVerticalScrollIndicator={false}
            >
              {detail.members.map((m) => (
                <View key={m.user_id} style={styles.memberRow}>
                  {avatarUri(m.avatar_url) ? (
                    <Image source={avatarUri(m.avatar_url)!} style={styles.memberAvatar} />
                  ) : (
                    <View style={[styles.memberAvatar, styles.memberAvatarEmpty]}>
                      <Ionicons name="person" size={17} color={color.textFaint} />
                    </View>
                  )}
                  <Text style={styles.memberName} numberOfLines={1}>
                    {m.display_name}
                    {m.user_id === user.id ? (
                      <Text style={styles.memberYou}> (you)</Text>
                    ) : null}
                  </Text>
                  {landmarkByUser.has(m.user_id) && (
                    <View style={styles.memberLandmark}>
                      <Ionicons name="location" size={11} color={color.teal} />
                      <Text style={styles.memberLandmarkText} numberOfLines={1}>
                        {landmarkByUser.get(m.user_id)}
                      </Text>
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
        </GlassSurface>
      </Reveal>

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable style={styles.leaveButton} onPress={leave} hitSlop={8}>
        <Text style={styles.leaveText}>Leave group</Text>
      </Pressable>
    </View>
  );
}
