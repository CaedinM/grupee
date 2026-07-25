import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { ApiError, createGroup, listEvents, type FestivalEvent, type Group } from "../api";
import { useTabBarClearance } from "../TabBar";
import { GlassButton, GlassSurface, Reveal, usePressScale } from "../ui/Glass";
import { color, radius, space, type } from "../ui/theme";
import BackLink from "./BackLink";
import { hasNotEnded } from "./events";
import { styles } from "./styles";

export default function CreateForm({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (group: Group) => void;
}) {
  const [name, setName] = useState("");
  const [events, setEvents] = useState<FestivalEvent[] | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clearance = useTabBarClearance();

  useEffect(() => {
    let cancelled = false;
    listEvents()
      // Finished festivals aren't joinable — a group made against one would be
      // retired into history the moment it appeared.
      .then((es) => {
        if (!cancelled) setEvents(es.filter(hasNotEnded));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A group is always tied to a festival, so creation requires picking one.
  const ready = name.trim().length > 0 && eventId !== null;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await createGroup(name.trim(), eventId!));
    } catch (e) {
      // The picker already hides finished festivals, so a 409 here means the
      // event ended while this form sat open — drop it from the list too.
      if (e instanceof ApiError && e.status === 409) {
        setEvents((prev) => prev?.filter((ev) => ev.id !== eventId) ?? prev);
        setEventId(null);
        setError("Can not create group: Event Ended");
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.formContent, { paddingBottom: clearance + space.lg }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <BackLink onPress={onBack} />

      <Reveal>
        <Text style={styles.eyebrow}>New crew</Text>
        <Text style={type.hero}>Name your group</Text>
      </Reveal>

      <Reveal delay={80}>
        <GlassSurface r={radius.md} sunken>
          <TextInput
            style={styles.input}
            placeholder="The Sunday Lads"
            placeholderTextColor={color.textFaint}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            maxLength={40}
            returnKeyType="done"
          />
        </GlassSurface>
      </Reveal>

      <Reveal delay={140}>
        <Text style={styles.sectionHeader}>Which festival?</Text>
        {events === null ? (
          <ActivityIndicator color={color.accentSoft} style={{ alignSelf: "flex-start" }} />
        ) : events.length === 0 ? (
          <Text style={styles.subtitle}>No upcoming festivals yet.</Text>
        ) : (
          events.map((event) => (
            <EventOption
              key={event.id}
              event={event}
              selected={event.id === eventId}
              onPress={() => setEventId(event.id)}
            />
          ))
        )}
      </Reveal>

      <Reveal delay={200} style={{ gap: space.md, marginTop: space.sm }}>
        <GlassButton
          label="Create group"
          onPress={submit}
          disabled={!ready || busy}
          busy={busy ? <ActivityIndicator color="#fff" /> : undefined}
        />
        {error && <Text style={styles.error}>{error}</Text>}
      </Reveal>
    </ScrollView>
  );
}

/** A festival, as a selectable pane. Selection lights the rim and the icon. */
function EventOption({
  event,
  selected,
  onPress,
}: {
  event: FestivalEvent;
  selected: boolean;
  onPress: () => void;
}) {
  const { scale, onPressIn, onPressOut } = usePressScale(0.98);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut}>
        <GlassSurface
          r={radius.md}
          intensity={selected ? 52 : 34}
          raised={selected}
          style={[styles.eventOption, selected && styles.eventOptionSelected]}
        >
          <View style={styles.eventOptionBody}>
            <Ionicons
              name="musical-notes"
              size={17}
              color={selected ? color.accentSoft : color.textFaint}
            />
            <Text style={[styles.eventOptionText, selected && styles.eventOptionTextSelected]}>
              {event.name}
            </Text>
            {selected && (
              <Ionicons name="checkmark-circle" size={20} color={color.accentSoft} />
            )}
          </View>
        </GlassSurface>
      </Pressable>
    </Animated.View>
  );
}
