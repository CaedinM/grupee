import { useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";

import { ApiError, getGroup, joinGroup, type Group } from "../api";
import { useTabBarClearance } from "../TabBar";
import { GlassButton, GlassSurface, Reveal } from "../ui/Glass";
import { radius, space, type } from "../ui/theme";
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
  const clearance = useTabBarClearance();

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
    <View style={[styles.card, { paddingBottom: clearance }]}>
      <View style={styles.backSlot}>
        <BackLink onPress={onBack} />
      </View>

      <Reveal>
        <Text style={styles.eyebrow}>Join a crew</Text>
        <Text style={type.hero}>Enter the code</Text>
        <Text style={[styles.subtitle, { marginTop: space.sm }]}>
          Four letters, from anyone already in the group.
        </Text>
      </Reveal>

      <Reveal delay={100}>
        {/* Four slots' worth of tracking, so the code lands on a fixed grid
            as it's typed rather than sliding as each glyph arrives. */}
        <GlassSurface r={radius.lg} sunken>
          <TextInput
            style={[styles.input, styles.codeInput]}
            placeholder="ABCD"
            placeholderTextColor="rgba(255,255,255,0.13)"
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={4}
            onSubmitEditing={submit}
            returnKeyType="go"
          />
        </GlassSurface>
      </Reveal>

      <Reveal delay={180} style={{ gap: space.md }}>
        <GlassButton
          label="Join"
          onPress={submit}
          disabled={cleaned.length !== 4 || busy}
          busy={busy ? <ActivityIndicator color="#fff" /> : undefined}
        />
        {error && <Text style={styles.error}>{error}</Text>}
      </Reveal>
    </View>
  );
}
