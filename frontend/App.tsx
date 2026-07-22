import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
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
import ProfileScreen from "./src/ProfileScreen";
import TabBar, { type Tab } from "./src/TabBar";
import { useEventLiveness } from "./src/useEventLiveness";
import { useLocationReporting } from "./src/useLocationReporting";

const PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function App() {
  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <StatusBar style="light" />
        {PUBLISHABLE_KEY ? (
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

  if (!isLoaded) return <View style={styles.container} />;
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
          // never catch up. Refresh in the background and ignore failures.
          setProfile(JSON.parse(raw));
          getMe()
            .then((u) => {
              if (!cancelled) persistProfile(u);
            })
            .catch(() => {});
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

  if (!hydrated) return <View style={styles.container} />;

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
  // Reporting lives here, not in a screen, so location keeps streaming to the
  // backend no matter which tab is open — but only while the user's group has
  // a live event; nobody gets tracked between festivals.
  const reporting = useLocationReporting(user.id, liveness.status === "live");

  // All screens stay mounted (hidden, not unmounted) so the map keeps its
  // camera position across tab switches.
  return (
    <View style={styles.container}>
      <View style={[styles.screen, tab !== "groups" && styles.hidden]}>
        <GroupsScreen user={user} liveness={liveness} onGroupChange={setActiveGroup} />
      </View>
      <View style={[styles.screen, tab !== "map" && styles.hidden]}>
        <MapScreen
          user={user}
          reporting={reporting}
          group={activeGroup}
          liveness={liveness}
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
      <TabBar tab={tab} onChange={setTab} />
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
      <Text style={styles.title}>You're in</Text>
      <Text style={styles.subtitle}>Pick a name your crew will recognize</Text>
      <TextInput
        style={styles.input}
        placeholder="Display name"
        placeholderTextColor="#55555f"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={40}
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      <Pressable
        style={[styles.button, (!name.trim() || busy) && styles.buttonDisabled]}
        onPress={submit}
        disabled={!name.trim() || busy}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Let's go</Text>}
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
      <Text style={styles.meta}>API: {BASE_URL}</Text>
    </View>
  );
}

function MissingKeyScreen() {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Auth not configured</Text>
      <Text style={styles.subtitle}>
        Set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in frontend/.env to the publishable key from your
        Clerk dashboard (API Keys), then restart `npm start` so Expo picks it up.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#101014",
  },
  screen: {
    flex: 1,
  },
  hidden: {
    display: "none",
  },
  card: {
    flex: 1,
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  title: {
    fontSize: 34,
    fontWeight: "800",
    color: "#fff",
  },
  subtitle: {
    fontSize: 16,
    color: "#9a9aa5",
  },
  input: {
    backgroundColor: "#1c1c22",
    color: "#fff",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
  },
  button: {
    backgroundColor: "#5b5bf0",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
  error: {
    color: "#ff6b6b",
    fontSize: 14,
  },
  meta: {
    color: "#55555f",
    fontSize: 12,
    textAlign: "center",
  },
});
