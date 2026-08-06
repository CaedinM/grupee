import { useUser } from "@clerk/clerk-expo";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  avatarSource,
  BASE_URL,
  deleteAvatar,
  updateUser,
  uploadAvatar,
  type PickedImage,
  type User,
} from "./api";
import { useTabBarClearance } from "./TabBar";
import {
  GlassButton,
  GlassCard,
  GlassSurface,
  PulseDot,
  Reveal,
  usePressScale,
} from "./ui/Glass";
import { color, font, glass, radius, ramp, shadow, space, type } from "./ui/theme";
import type { LocationReporting } from "./useLocationReporting";

// The backend only stores these three; asking the picker to crop and re-encode
// means iOS hands back a JPEG rather than the original HEIC.
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export default function ProfileScreen({
  user,
  reporting,
  onUserChange,
  onReset,
}: {
  user: User;
  reporting: LocationReporting;
  onUserChange: (user: User) => void;
  onReset: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  // The account page and its settings live on one screen; a gear in the top
  // right swaps between them rather than adding another entry to the tab bar.
  const [showSettings, setShowSettings] = useState(false);
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();

  if (showSettings) {
    return (
      <SettingsScreen
        user={user}
        reporting={reporting}
        onReset={onReset}
        onBack={() => setShowSettings(false)}
      />
    );
  }

  const live = reporting.permission === "granted" && reporting.sentCount > 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top + space.md }]}>
      <View style={styles.topBar}>
        <Text style={styles.eyebrow}>Your profile</Text>
        <GlassIconButton icon="settings-outline" onPress={() => setShowSettings(true)} />
      </View>

      {/* The floating tab bar overlays the bottom of the screen, so the hero
          centres in what's left of it rather than in the full height. */}
      <View style={[styles.hero, { paddingBottom: clearance }]}>
        <Reveal>
          <Avatar user={user} onUserChange={onUserChange} onError={setError} />
        </Reveal>

        <Reveal delay={80} style={styles.identity}>
          <DisplayName user={user} onUserChange={onUserChange} onError={setError} />
          <StatusPill live={live} denied={reporting.permission === "denied"} />
        </Reveal>

        {error && (
          <Text style={styles.error} numberOfLines={3}>
            {error}
          </Text>
        )}
      </View>
    </View>
  );
}

/** The gear, and the back chevron on settings — a small circular pane. */
function GlassIconButton({
  icon,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  const { scale, onPressIn, onPressOut } = usePressScale(0.9);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} hitSlop={10}>
        <GlassSurface r={radius.pill} intensity={50} style={styles.iconButton}>
          <View style={styles.iconButtonInner}>
            <Ionicons name={icon} size={20} color={color.text} />
          </View>
        </GlassSurface>
      </Pressable>
    </Animated.View>
  );
}

/** Whether location is actually reaching the backend, stated plainly. */
function StatusPill({ live, denied }: { live: boolean; denied: boolean }) {
  const tone = denied ? color.danger : live ? color.teal : color.textDim;
  return (
    <GlassSurface r={radius.pill} intensity={36} sheen={false} style={styles.statusPill}>
      <View style={styles.statusInner}>
        {live ? <PulseDot color={color.teal} /> : <View style={[styles.dot, { backgroundColor: tone }]} />}
        <Text style={[styles.statusText, { color: tone }]}>
          {denied ? "Location off" : live ? "Sharing location" : "Standing by"}
        </Text>
      </View>
    </GlassSurface>
  );
}

function SettingsScreen({
  user,
  reporting,
  onReset,
  onBack,
}: {
  user: User;
  reporting: LocationReporting;
  onReset: () => void;
  onBack: () => void;
}) {
  const sharing = reporting.permission === "granted" && reporting.sentCount > 0;
  // The Clerk account behind this profile — for showing the signed-in email.
  const { user: account } = useUser();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.settingsContent,
        { paddingTop: insets.top + space.md, paddingBottom: clearance + space.lg },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topBar}>
        <GlassIconButton icon="chevron-back" onPress={onBack} />
      </View>

      <Reveal>
        <Text style={styles.eyebrow}>Account</Text>
        <Text style={type.hero}>Settings</Text>
      </Reveal>

      <Reveal delay={70}>
        <Text style={styles.sectionLabel}>Location</Text>
        <GlassCard>
          <Row
            label="Sharing"
            value={
              reporting.permission === "denied"
                ? "Permission denied"
                : sharing
                  ? "Active"
                  : "Waiting…"
            }
            tone={
              reporting.permission === "denied"
                ? color.danger
                : sharing
                  ? color.teal
                  : color.textDim
            }
          />
          <Divider />
          {/* Worth its own row: with this off, the crew loses you the moment the
              phone goes in a pocket, and sets you watched aren't counted. */}
          <Row
            label="In the background"
            value={
              reporting.backgroundPermission === "granted"
                ? "On"
                : reporting.backgroundPermission === "asking"
                  ? "Waiting…"
                  : reporting.backgroundPermission === "unsupported"
                    ? "Needs the full app"
                    : "Off — set Location to Always"
            }
            tone={
              reporting.backgroundPermission === "granted" ? color.teal : color.textDim
            }
          />
          <Divider />
          <Row label="Updates sent" value={String(reporting.sentCount)} mono />
        </GlassCard>
      </Reveal>

      <Reveal delay={130}>
        <Text style={styles.sectionLabel}>Identity</Text>
        <GlassCard>
          {account?.primaryEmailAddress && (
            <>
              <Row label="Email" value={account.primaryEmailAddress.emailAddress} />
              <Divider />
            </>
          )}
          <Row label="User ID" value={user.id} mono small />
          <Divider />
          <Row label="API" value={BASE_URL} mono small />
        </GlassCard>
      </Reveal>

      <Reveal delay={190}>
        <GlassButton label="Sign out" variant="glass" onPress={onReset} style={styles.signOut} />
      </Reveal>
    </ScrollView>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

function Avatar({
  user,
  onUserChange,
  onError,
}: {
  user: User;
  onUserChange: (user: User) => void;
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const source = avatarSource(user);
  const { scale, onPressIn, onPressOut } = usePressScale(0.95);

  const pick = async () => {
    onError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      onError("Photo access is off. Enable it in Settings to set a picture.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    // The picker omits mimeType on some platforms; a cropped pick is a JPEG.
    const type = asset.mimeType ?? "image/jpeg";
    if (!ACCEPTED_TYPES.has(type)) {
      onError("Pick a JPEG, PNG, or WebP image.");
      return;
    }

    setBusy(true);
    try {
      onUserChange(
        await uploadAvatar(user.id, {
          uri: asset.uri,
          name: asset.fileName ?? `avatar.${type.split("/")[1]}`,
          type,
        } satisfies PickedImage)
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    onError(null);
    try {
      await deleteAvatar(user.id);
      onUserChange({ ...user, avatar_url: null });
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Removal is a plain link rather than an action sheet because Alert.alert is
  // a no-op under react-native-web, and this screen ships on web too.
  return (
    <View style={styles.avatarBlock}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable
          style={styles.avatarWrap}
          onPress={pick}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          disabled={busy}
        >
          {/* A soft accent glow, so the avatar reads as the lit object on the
              screen rather than a hole punched in the glass. */}
          <View style={styles.avatarGlow} pointerEvents="none" />
          <View style={styles.avatarRing}>
            {source ? (
              <Image source={source} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarEmpty]}>
                <Ionicons name="person" size={48} color={color.accentSoft} />
              </View>
            )}
            {/* The lens highlight arcing across the top of the sphere. */}
            <LinearGradient
              colors={["rgba(255,255,255,0.30)", "rgba(255,255,255,0)"]}
              start={{ x: 0.2, y: 0 }}
              end={{ x: 0.7, y: 0.75 }}
              style={styles.avatarSheen}
              pointerEvents="none"
            />
          </View>
          <View style={styles.avatarBadge}>
            <LinearGradient
              colors={ramp.accent}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name="camera" size={15} color="#fff" />
            )}
          </View>
        </Pressable>
      </Animated.View>
      {source && (
        <Pressable onPress={remove} disabled={busy} hitSlop={8}>
          <Text style={styles.removeText}>Remove picture</Text>
        </Pressable>
      )}
    </View>
  );
}

function DisplayName({
  user,
  onUserChange,
  onError,
}: {
  user: User;
  onUserChange: (user: User) => void;
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(user.display_name);
  const [busy, setBusy] = useState(false);

  // Keep the draft in step when the name changes elsewhere (e.g. a failed save
  // that got rolled back, or a fresh user after "Start over").
  useEffect(() => {
    if (!editing) setDraft(user.display_name);
  }, [user.display_name, editing]);

  const cancel = () => {
    setDraft(user.display_name);
    setEditing(false);
    onError(null);
  };

  const save = async () => {
    const trimmed = draft.trim();
    if (!trimmed || busy) return;
    if (trimmed === user.display_name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    onError(null);
    try {
      onUserChange(await updateUser(user.id, trimmed));
      setEditing(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <Pressable style={styles.nameRow} onPress={() => setEditing(true)} hitSlop={8}>
        <Text style={styles.name} numberOfLines={2}>
          {user.display_name}
        </Text>
        <View style={styles.pencil}>
          <Ionicons name="pencil" size={13} color={color.accentSoft} />
        </View>
      </Pressable>
    );
  }

  return (
    <View style={styles.nameEditor}>
      <GlassSurface r={radius.md} sunken style={styles.nameInputWrap}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Your name"
          placeholderTextColor={color.textFaint}
          autoCapitalize="words"
          autoCorrect={false}
          autoFocus
          maxLength={40}
          selectTextOnFocus
          onSubmitEditing={save}
          returnKeyType="done"
        />
      </GlassSurface>
      <GlassButton
        label="Save"
        onPress={save}
        disabled={!draft.trim() || busy}
        busy={busy ? <ActivityIndicator color="#fff" /> : undefined}
        style={styles.fullWidth}
      />
      <Pressable style={styles.cancelButton} onPress={cancel} disabled={busy} hitSlop={8}>
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function Row({
  label,
  value,
  small,
  mono,
  tone,
}: {
  label: string;
  value: string;
  small?: boolean;
  mono?: boolean;
  tone?: string;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          mono && styles.rowValueMono,
          small && styles.rowValueSmall,
          tone ? { color: tone } : null,
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const AVATAR_SIZE = 128;
const RING = 4;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: space.xl,
  },
  scroll: {
    flex: 1,
  },
  settingsContent: {
    paddingHorizontal: space.xl,
    gap: space.xl,
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 40,
  },
  eyebrow: {
    ...type.label,
    color: color.accentSoft,
  },
  sectionLabel: {
    ...type.label,
    marginBottom: space.md,
  },
  iconButton: {
    width: 40,
    height: 40,
  },
  iconButtonInner: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  // The hero sits slightly above true centre — dead-centring a single column
  // under a floating tab bar reads as low.
  hero: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space.xl,
  },
  identity: {
    alignItems: "center",
    gap: space.md,
    width: "100%",
  },
  avatarBlock: {
    alignItems: "center",
    gap: space.md,
  },
  avatarWrap: {
    width: AVATAR_SIZE + RING * 2,
    height: AVATAR_SIZE + RING * 2,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarGlow: {
    position: "absolute",
    width: AVATAR_SIZE + 56,
    height: AVATAR_SIZE + 56,
    borderRadius: (AVATAR_SIZE + 56) / 2,
    backgroundColor: color.accent,
    opacity: 0.22,
    ...shadow.accent,
  },
  avatarRing: {
    width: AVATAR_SIZE + RING * 2,
    height: AVATAR_SIZE + RING * 2,
    borderRadius: (AVATAR_SIZE + RING * 2) / 2,
    borderWidth: RING,
    borderColor: glass.strokeBright,
    overflow: "hidden",
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  avatarEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  avatarSheen: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarBadge: {
    position: "absolute",
    right: 2,
    bottom: 6,
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: color.void,
  },
  removeText: {
    fontFamily: font.sansMedium,
    color: color.accentSoft,
    fontSize: 13,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.md,
  },
  name: {
    ...type.hero,
    fontSize: 34,
    lineHeight: 38,
    textAlign: "center",
    flexShrink: 1,
  },
  pencil: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(167,158,255,0.14)",
  },
  statusPill: {
    alignSelf: "center",
  },
  statusInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  statusText: {
    fontFamily: font.sansSemi,
    fontSize: 12,
    letterSpacing: 0.2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  nameEditor: {
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
    alignItems: "center",
    gap: space.md,
  },
  nameInputWrap: {
    width: "100%",
  },
  fullWidth: {
    width: "100%",
  },
  input: {
    fontFamily: font.sansMedium,
    color: color.text,
    paddingHorizontal: space.lg,
    paddingVertical: 15,
    fontSize: 17,
    textAlign: "center",
  },
  cancelButton: {
    paddingVertical: space.xs,
  },
  cancelText: {
    fontFamily: font.sansMedium,
    color: color.accentSoft,
    fontSize: 14,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.lg,
    paddingVertical: 11,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: glass.strokeSoft,
  },
  rowLabel: {
    fontFamily: font.sans,
    color: color.textDim,
    fontSize: 14,
  },
  rowValue: {
    fontFamily: font.sansMedium,
    color: color.text,
    fontSize: 14,
    flexShrink: 1,
    textAlign: "right",
  },
  rowValueMono: {
    fontFamily: font.mono,
  },
  rowValueSmall: {
    fontSize: 11,
    color: color.textDim,
  },
  error: {
    fontFamily: font.sansMedium,
    color: color.danger,
    fontSize: 13,
    textAlign: "center",
  },
  signOut: {
    marginTop: space.sm,
  },
});
