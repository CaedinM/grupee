import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { ApiError, getGroup, joinGroup, type Group } from "../api";
import BackLink from "./BackLink";
import { styles } from "./styles";

/**
 * The backend rejects a join for a finished festival with 409 (404 stays "no
 * such code"). Both get fixed copy rather than the server's `detail`, so the
 * wording lives with the screen that shows it.
 */
function joinErrorMessage(e: unknown, code: string): string {
  if (e instanceof ApiError && e.status === 409) return "Can not join group: Event Ended";
  if (e instanceof ApiError && e.status === 404) return `No group found with code ${code}.`;
  return e instanceof Error ? e.message : String(e);
}

export default function JoinForm({
  onBack,
  onJoined,
}: {
  onBack: () => void;
  onJoined: (group: Group) => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleaned = code.trim().toUpperCase();

  const submit = async () => {
    if (cleaned.length !== 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const membership = await joinGroup(cleaned);
      onJoined(await getGroup(membership.group_id));
    } catch (e) {
      setError(joinErrorMessage(e, cleaned));
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <BackLink onPress={onBack} />
      <Text style={styles.title}>Enter the code</Text>
      <Text style={styles.subtitle}>Ask a group member for their 4-letter code.</Text>
      <TextInput
        style={[styles.input, styles.codeInput]}
        placeholder="ABCD"
        placeholderTextColor="#55555f"
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={4}
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      <Pressable
        style={[styles.button, (cleaned.length !== 4 || busy) && styles.buttonDisabled]}
        onPress={submit}
        disabled={cleaned.length !== 4 || busy}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Join</Text>}
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}
