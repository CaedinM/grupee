import { useUser } from "@clerk/clerk-expo";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  avatarSource,
  BASE_URL,
  deleteAvatar,
  updateUser,
  uploadAvatar,
  type PickedImage,
  type User,
} from "./api";
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
  const sharing = reporting.permission === "granted" && reporting.sentCount > 0;
  const [error, setError] = useState<string | null>(null);
  // The Clerk account behind this profile — for showing the signed-in email.
  const { user: account } = useUser();

  return (
    <View style={styles.container}>
      <Avatar user={user} onUserChange={onUserChange} onError={setError} />
      <DisplayName user={user} onUserChange={onUserChange} onError={setError} />

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.rows}>
        <Row
          label="Location sharing"
          value={
            reporting.permission === "denied" ? "Permission denied" : sharing ? "Active" : "Waiting…"
          }
        />
        <Row label="Updates sent" value={String(reporting.sentCount)} />
        {account?.primaryEmailAddress && (
          <Row label="Email" value={account.primaryEmailAddress.emailAddress} />
        )}
        <Row label="User ID" value={user.id} small />
        <Row label="API" value={BASE_URL} small />
      </View>

      <Pressable style={styles.signOut} onPress={onReset}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </View>
  );
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
      <Pressable style={styles.avatarWrap} onPress={pick} disabled={busy}>
        {source ? (
          <Image source={source} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarEmpty]}>
            <Ionicons name="person" size={44} color="#5b5bf0" />
          </View>
        )}
        <View style={styles.avatarBadge}>
          {busy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons name="camera" size={16} color="#fff" />
          )}
        </View>
      </Pressable>
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
        <Text style={styles.name}>{user.display_name}</Text>
        <Ionicons name="pencil" size={18} color="#8b8bf5" />
      </Pressable>
    );
  }

  return (
    <View style={styles.nameEditor}>
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        placeholder="Your name"
        placeholderTextColor="#55555f"
        autoCapitalize="words"
        autoCorrect={false}
        autoFocus
        maxLength={40}
        selectTextOnFocus
        onSubmitEditing={save}
        returnKeyType="done"
      />
      <Pressable
        style={[styles.saveButton, (!draft.trim() || busy) && styles.buttonDisabled]}
        onPress={save}
        disabled={!draft.trim() || busy}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
      </Pressable>
      <Pressable style={styles.cancelButton} onPress={cancel} disabled={busy} hitSlop={8}>
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function Row({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, small && styles.rowValueSmall]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const AVATAR_SIZE = 104;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#101014",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  avatarBlock: {
    alignItems: "center",
    gap: 8,
  },
  avatarWrap: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
  },
  removeText: {
    color: "#8b8bf5",
    fontSize: 14,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: "#1c1c22",
  },
  avatarEmpty: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#2a2a32",
  },
  avatarBadge: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#5b5bf0",
    borderWidth: 3,
    borderColor: "#101014",
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  name: {
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
  },
  nameEditor: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    gap: 10,
  },
  input: {
    width: "100%",
    backgroundColor: "#1c1c22",
    color: "#fff",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    textAlign: "center",
  },
  saveButton: {
    width: "100%",
    backgroundColor: "#5b5bf0",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  saveText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
  cancelButton: {
    paddingVertical: 4,
  },
  cancelText: {
    color: "#8b8bf5",
    fontSize: 15,
  },
  rows: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#1c1c22",
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
  },
  rowLabel: {
    color: "#9a9aa5",
    fontSize: 15,
  },
  rowValue: {
    color: "#fff",
    fontSize: 15,
    flexShrink: 1,
  },
  rowValueSmall: {
    fontSize: 12,
    color: "#c5c5cf",
  },
  error: {
    color: "#ff6b6b",
    fontSize: 14,
    textAlign: "center",
  },
  signOut: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: "#2a2a32",
  },
  signOutText: {
    color: "#ff6b6b",
    fontSize: 15,
    fontWeight: "600",
  },
});
