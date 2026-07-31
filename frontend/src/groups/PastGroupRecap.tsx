import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import {
  avatarUri,
  listMyAttendance,
  type FestivalEvent,
  type Group,
  type GroupDetail,
  type SetAttendance,
} from "../api";
import { GlassSurface } from "../ui/Glass";
import { color, radius, space } from "../ui/theme";
import { formatEventDates, formatSetSlot } from "./events";
import { styles } from "./styles";

/**
 * The recap behind a finished group's card: who the crew was, and which acts
 * *you* were credited with seeing at that festival.
 *
 * Attendance is fetched lazily, on the first open, rather than alongside the
 * card — the chooser can list many past festivals and none of them need this
 * until tapped. Rows are self-only by construction (`GET /users/me/attendance`),
 * so this is deliberately "who I saw", never a groupmate's recap.
 */
export default function PastGroupRecap({
  visible,
  group,
  event,
  detail,
  onClose,
}: {
  visible: boolean;
  group: Group;
  event: FestivalEvent;
  /** The roster the card already loaded; null while it is still in flight. */
  detail: GroupDetail | null;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  const [seen, setSeen] = useState<SetAttendance[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Only once the sheet has actually been opened, and only once per event —
    // attendance for a finished festival can't change.
    if (!visible || seen !== null) return;
    let cancelled = false;
    setFailed(false);
    listMyAttendance(event.id)
      .then((rows) => {
        if (!cancelled) setSeen(rows);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, event.id, seen]);

  const dates = formatEventDates(event.starts_at, event.ends_at);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetOverlay} onPress={onClose}>
        {/* Swallow taps on the sheet so the backdrop press doesn't dismiss it. */}
        <Pressable onPress={() => {}} style={styles.recapCard}>
          <GlassSurface r={radius.lg} raised>
            <View style={styles.recapBody}>
              <View style={styles.recapHeader}>
                <View style={styles.recapHeaderText}>
                  <Text style={styles.eyebrow}>{group.name}</Text>
                  <Text style={styles.recapTitle} numberOfLines={2}>
                    {event.name}
                  </Text>
                  {dates && <Text style={styles.recapDates}>{dates}</Text>}
                </View>
                <Pressable onPress={onClose} hitSlop={10} style={styles.recapClose}>
                  <Ionicons name="close" size={18} color={color.textDim} />
                </Pressable>
              </View>

              <ScrollView
                style={{ maxHeight: height * 0.5 }}
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.sectionHeader}>
                  The crew{detail ? ` · ${detail.members.length}` : ""}
                </Text>
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

                <Text style={styles.sectionHeader}>
                  Who I saw{seen && seen.length > 0 ? ` · ${seen.length}` : ""}
                </Text>
                <SeenList rows={seen} failed={failed} />
              </ScrollView>
            </View>
          </GlassSurface>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SeenList({ rows, failed }: { rows: SetAttendance[] | null; failed: boolean }) {
  if (failed) {
    return <Text style={styles.recapEmpty}>Couldn&apos;t load your sets.</Text>;
  }
  if (rows === null) {
    return <ActivityIndicator color={color.accentSoft} style={styles.pastMembersLoading} />;
  }
  if (rows.length === 0) {
    return (
      <Text style={styles.recapEmpty}>
        No sets tracked — you need to be at a stage while an act is playing.
      </Text>
    );
  }
  return (
    <GlassSurface r={radius.md} intensity={26} sunken sheen={false} style={styles.recapSeenList}>
      <View style={{ paddingVertical: space.xs }}>
        {rows.map((row) => (
          <View key={row.set_id} style={styles.recapSeenRow}>
            <Ionicons name="musical-notes" size={13} color={color.magenta} />
            <View style={styles.recapSeenText}>
              <Text style={styles.recapArtist} numberOfLines={1}>
                {row.artist}
              </Text>
              <Text style={styles.recapSeenMeta} numberOfLines={1}>
                {[row.stage_name, formatSetSlot(row.start_time)].filter(Boolean).join(" · ")}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </GlassSurface>
  );
}
