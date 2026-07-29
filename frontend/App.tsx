import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  ApiError,
  BASE_URL,
  createUser,
  getMe,
  setTokenGetter,
  type Group,
  type User,
} from "./src/api";
import AuthScreen from "./src/AuthScreen";
import GroupsScreen from "./src/groups/GroupsScreen";
import MapScreen from "./src/MapScreen";
import MyEventScreen from "./src/MyEventScreen";
import ProfileScreen from "./src/ProfileScreen";
import TabBar, { type Tab } from "./src/TabBar";
import { useNightglassFonts } from "./src/ui/fonts";
import { Aurora, GlassButton, GlassSurface, Reveal } from "./src/ui/Glass";
import { color, font, radius, space, type } from "./src/ui/theme";
import { useEventLiveness } from "./src/useEventLiveness";
import { useLocationReporting } from "./src/useLocationReporting";
import { useLocationSocket } from "./src/useLocationSocket";

const PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function App() {
  // Every `fontFamily` token in the theme is inert until these resolve, so the
  // shell holds back rather than flashing a system-font frame first.
  const fontsReady = useNightglassFonts();

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <StatusBar style="light" />
        {/* Painted once, behind everything: the light every pane refracts. */}
        <Aurora />
        {!fontsReady ? null : PUBLISHABLE_KEY ? (
          <ClerkProvider publishableKey={PUBLISHABLE_KEY} tokenCache={tokenCache}>
            <Root />
          </ClerkProvider>
        ) : (
          <MissingKeyScreen />
        )}
      </View>
    </SafeAreaProvider>
  );
}

function Root() {
  const { isLoaded, isSignedIn, userId, getToken, signOut } = useAuth();

  // Registered during render, not in an effect — child effects fire before
  // parent effects on mount, so an effect here would let the first API calls
  // go out without a token.
  setTokenGetter(isSignedIn ? getToken : null);

  // Transparent, not opaque — the Aurora behind it is the loading state.
  if (!isLoaded) return <View style={styles.screen} />;
  if (!isSignedIn) return <AuthScreen />;
  // Keyed by account so switching accounts never shows the previous
  // account's cached profile.
  return <ProfileGate key={userId} clerkUserId={userId!} onSignOut={() => signOut()} />;
}

/**
 * Bridges Clerk's session to the backend profile: loads the cached profile
 * (so the app opens offline), refreshes it from /users/me, and walks new
 * accounts through picking a display name.
 */
function ProfileGate({
  clerkUserId,
  onSignOut,
}: {
  clerkUserId: string;
  onSignOut: () => void;
}) {
  const cacheKey = `wta.user.${clerkUserId}`;
  const [profile, setProfile] = useState<User | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const persistProfile = (u: User) => {
    setProfile(u);
    AsyncStorage.setItem(cacheKey, JSON.stringify(u));
  };

  useEffect(() => {
    // Pre-auth builds cached an anonymous user under this key; clear it once.
    AsyncStorage.removeItem("wta.user");

    let cancelled = false;
    AsyncStorage.getItem(cacheKey)
      .then(async (raw) => {
        if (raw && !cancelled) {
          // The cache is the source of truth for rendering (so the app opens
          // offline), but a profile edited on another device would otherwise
          // never catch up. Refresh in the background.
          setProfile(JSON.parse(raw));
          getMe()
            .then((u) => {
              if (!cancelled) persistProfile(u);
            })
            .catch((e) => {
              // 404 means the cached profile no longer exists server-side —
              // the account was deleted, or the backend was pointed at a fresh
              // database. Drop the stale cache and fall through to NameScreen,
              // which re-provisions through the idempotent createUser; keeping
              // it would leave the app rendering a user id the server doesn't
              // have, and every user-scoped write would 404. Any other failure
              // (offline, server down) keeps the cache so the app still opens.
              if (e instanceof ApiError && e.status === 404) {
                AsyncStorage.removeItem(cacheKey);
                if (!cancelled) setProfile(null);
              }
            });
          return;
        }
        try {
          const u = await getMe();
          if (!cancelled) persistProfile(u);
        } catch (e) {
          // 404 = signed in but no profile yet → the name screen handles it.
          // Other failures (offline, server down) also fall through to the
          // name screen, which is safe: createUser is idempotent per account.
          if (!(e instanceof ApiError && e.status === 404)) console.warn(e);
        }
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey]);

  if (!hydrated) return <View style={styles.screen} />;

  if (!profile) return <NameScreen onRegistered={persistProfile} />;

  return (
    <SignedInApp user={profile} onUserChange={persistProfile} onSignOut={onSignOut} />
  );
}

function SignedInApp({
  user,
  onUserChange,
  onSignOut,
}: {
  user: User;
  onUserChange: (user: User) => void;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>("map");
  // Owned by GroupsScreen's flow, mirrored here so the map knows which
  // group's locations to poll and display.
  const [activeGroup, setActiveGroup] = useState<Group | null>(null);
  const liveness = useEventLiveness(activeGroup);
  // One WebSocket to the active group, resolved once here so the map, the groups
  // tab, and the reporting side all share it. `send` streams this device's
  // position up; `members` is every peer's live position pushed down. Both are
  // gated on a live event — nobody streams or is streamed to between festivals.
  const live = liveness.status === "live";
  const socket = useLocationSocket(user.id, live ? (activeGroup?.id ?? null) : null, live);
  // Reporting lives here, not in a screen, so location keeps streaming no matter
  // which tab is open. It owns GPS acquisition (10m movement filter + heartbeat)
  // and pushes each fix up the socket.
  const reporting = useLocationReporting(user.id, live, socket.send);

  // All screens stay mounted (hidden, not unmounted) so the map keeps its
  // camera position across tab switches.
  return (
    <View style={styles.screen}>
      <View style={[styles.screen, tab !== "groups" && styles.hidden]}>
        <GroupsScreen
          user={user}
          liveness={liveness}
          memberLocations={socket.members}
          onGroupChange={setActiveGroup}
        />
      </View>
      <View style={[styles.screen, tab !== "event" && styles.hidden]}>
        <MyEventScreen liveness={liveness} />
      </View>
      <View style={[styles.screen, tab !== "map" && styles.hidden]}>
        <MapScreen
          user={user}
          reporting={reporting}
          group={activeGroup}
          liveness={liveness}
          members={socket.members}
          membersError={socket.error}
          onOpenGroups={() => setTab("groups")}
        />
      </View>
      <View style={[styles.screen, tab !== "profile" && styles.hidden]}>
        <ProfileScreen
          user={user}
          reporting={reporting}
          onUserChange={onUserChange}
          onReset={onSignOut}
        />
      </View>
      {/* Overlaid, not docked: every screen runs full-bleed to the bottom of
          the display and the capsule floats in front of it. `box-none` keeps
          the gaps around the capsule pass-through, so the map still pans
          where the bar isn't. */}
      <View style={styles.tabBarLayer} pointerEvents="box-none">
        <TabBar tab={tab} onChange={setTab} />
      </View>
    </View>
  );
}

/** Post-verification step for brand-new accounts: pick the display name. */
function NameScreen({ onRegistered }: { onRegistered: (u: User) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      onRegistered(await createUser(trimmed));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <Reveal>
        <Text style={styles.eyebrow}>Welcome</Text>
        <Text style={type.hero}>You're in.</Text>
        <Text style={[type.subtitle, styles.lede]}>
          Pick a name your crew will recognise in the dark.
        </Text>
      </Reveal>

      <Reveal delay={90} style={styles.formBlock}>
        <GlassSurface r={radius.md} sunken>
          <TextInput
            style={styles.input}
            placeholder="Display name"
            placeholderTextColor={color.textFaint}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={40}
            onSubmitEditing={submit}
            returnKeyType="go"
          />
        </GlassSurface>
        <GlassButton
          label="Let's go"
          onPress={submit}
          disabled={!name.trim() || busy}
          busy={busy ? <ActivityIndicator color="#fff" /> : undefined}
        />
        {error && <Text style={styles.error}>{error}</Text>}
      </Reveal>

      <Text style={styles.meta}>{BASE_URL}</Text>
    </View>
  );
}

function MissingKeyScreen() {
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>Setup</Text>
      <Text style={type.title}>Auth not configured</Text>
      <Text style={type.subtitle}>
        Set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in frontend/.env to the publishable key from your
        Clerk dashboard (API Keys), then restart `npm start` so Expo picks it up.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.void,
  },
  screen: {
    flex: 1,
  },
  hidden: {
    display: "none",
  },
  tabBarLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  card: {
    flex: 1,
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    justifyContent: "center",
    gap: space.lg,
    padding: space.xl,
  },
  eyebrow: {
    ...type.label,
    marginBottom: space.sm,
    color: color.accentSoft,
  },
  lede: {
    marginTop: space.sm,
  },
  formBlock: {
    gap: space.md,
  },
  input: {
    fontFamily: font.sansMedium,
    color: color.text,
    paddingHorizontal: space.lg,
    paddingVertical: 15,
    fontSize: 17,
  },
  error: {
    fontFamily: font.sansMedium,
    color: color.danger,
    fontSize: 14,
  },
  meta: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: space.xl,
    fontFamily: font.mono,
    color: "rgba(255,255,255,0.20)",
    fontSize: 11,
    textAlign: "center",
  },
});
