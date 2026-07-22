import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import {
  getUserGroups,
  listEvents,
  type FestivalEvent,
  type Group,
  type User,
  type UserGroup,
} from "../api";
import { type EventLiveness } from "../useEventLiveness";
import Chooser from "./Chooser";
import CodeReveal from "./CodeReveal";
import CreateForm from "./CreateForm";
import { hasNotEnded, type PastGroup } from "./events";
import GroupView from "./GroupView";
import JoinForm from "./JoinForm";
import { styles } from "./styles";

type Mode =
  | { name: "loading" }
  | { name: "chooser" }
  | { name: "create" }
  | { name: "join" }
  | { name: "reveal"; group: Group } // just created — show the code big, then continue
  | { name: "group"; group: Group };

export default function GroupsScreen({
  user,
  liveness,
  onGroupChange,
}: {
  user: User;
  /** Liveness of the active group's event, resolved one level up in App. */
  liveness: EventLiveness;
  onGroupChange: (group: Group | null) => void;
}) {
  const [mode, setMode] = useState<Mode>({ name: "loading" });
  const [pastGroups, setPastGroups] = useState<PastGroup[]>([]);

  // Let the rest of the app (the map) know which group is active. A freshly
  // created group counts immediately — the creator is already a member.
  const activeGroup = mode.name === "group" || mode.name === "reveal" ? mode.group : null;
  useEffect(() => {
    if (mode.name !== "loading") onGroupChange(activeGroup);
  }, [mode.name, activeGroup?.id]);

  // The festival can end while the app is open, so don't rely on the load-time
  // split alone: the moment liveness flips to "ended", retire the group into
  // history and hand the user back the create/join chooser.
  const endedEvent = liveness.status === "ended" ? liveness.event : null;
  useEffect(() => {
    if (!activeGroup || !endedEvent) return;
    const group = activeGroup;
    setPastGroups((prev) =>
      prev.some((p) => p.group.id === group.id) ? prev : [{ group, event: endedEvent }, ...prev]
    );
    setMode({ name: "chooser" });
  }, [activeGroup?.id, endedEvent?.id]);

  // Memberships live on the backend, so the active group survives app restarts.
  // The event list comes along in the same pass to split finished festivals off
  // into the history section — one request beats one getEvent per group.
  useEffect(() => {
    let cancelled = false;
    Promise.all([getUserGroups(user.id), listEvents()])
      .then(([groups, events]) => {
        if (cancelled) return;
        const eventsById = new Map(events.map((e) => [e.id, e]));
        const finishedEvent = (group: UserGroup): FestivalEvent | null => {
          const event = group.event_id ? eventsById.get(group.event_id) : undefined;
          return event && !hasNotEnded(event) ? event : null;
        };

        const past: PastGroup[] = [];
        let active: UserGroup | null = null;
        for (const group of groups) {
          const event = finishedEvent(group);
          if (event) past.push({ group, event });
          else active ??= group;
        }
        // Newest festival first — history reads better that way.
        past.sort((a, b) => Date.parse(b.event.ends_at!) - Date.parse(a.event.ends_at!));

        setPastGroups(past);
        setMode(active ? { name: "group", group: active } : { name: "chooser" });
      })
      .catch(() => {
        if (!cancelled) setMode({ name: "chooser" });
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const toChooser = useCallback(() => setMode({ name: "chooser" }), []);

  switch (mode.name) {
    case "loading":
      return (
        <View style={styles.center}>
          <ActivityIndicator color="#5b5bf0" />
        </View>
      );
    case "chooser":
      return (
        <Chooser
          onCreate={() => setMode({ name: "create" })}
          onJoin={() => setMode({ name: "join" })}
          pastGroups={pastGroups}
        />
      );
    case "create":
      return (
        <CreateForm onBack={toChooser} onCreated={(group) => setMode({ name: "reveal", group })} />
      );
    case "join":
      return <JoinForm onBack={toChooser} onJoined={(group) => setMode({ name: "group", group })} />;
    case "reveal":
      return (
        <CodeReveal
          group={mode.group}
          onContinue={() => setMode({ name: "group", group: mode.group })}
        />
      );
    case "group":
      return <GroupView user={user} group={mode.group} onLeft={toChooser} />;
  }
}
