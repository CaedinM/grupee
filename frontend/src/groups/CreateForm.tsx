import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { ApiError, createGroup, listEvents, type FestivalEvent, type Group } from "../api";
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
    <View style={styles.card}>
      <BackLink onPress={onBack} />
      <Text style={styles.title}>Name your group</Text>
      <TextInput
        style={styles.input}
        placeholder="Group name"
        placeholderTextColor="#55555f"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        maxLength={40}
        returnKeyType="done"
      />

      <Text style={styles.sectionHeader}>Which festival?</Text>
      {events === null ? (
        <ActivityIndicator color="#5b5bf0" />
      ) : events.length === 0 ? (
        <Text style={styles.subtitle}>No upcoming festivals yet.</Text>
      ) : (
        events.map((event) => {
          const selected = event.id === eventId;
          return (
            <Pressable
              key={event.id}
              style={[styles.eventOption, selected && styles.eventOptionSelected]}
              onPress={() => setEventId(event.id)}
            >
              <Ionicons name="musical-notes" size={18} color={selected ? "#8b8bf5" : "#71717c"} />
              <Text style={[styles.eventOptionText, selected && styles.eventOptionTextSelected]}>
                {event.name}
              </Text>
              {selected && <Ionicons name="checkmark-circle" size={20} color="#8b8bf5" />}
            </Pressable>
          );
        })
      )}

      <Pressable
        style={[styles.button, (!ready || busy) && styles.buttonDisabled]}
        onPress={submit}
        disabled={!ready || busy}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Create</Text>}
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}
