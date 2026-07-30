import { useSignIn, useSignUp } from "@clerk/clerk-expo";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { GlassButton, GlassSurface, Reveal } from "./ui/Glass";
import { color, font, radius, space, type } from "./ui/theme";

type Mode = "signIn" | "signUp" | "verify";

/** Clerk errors carry a structured list; surface the human-readable one. */
function clerkMessage(e: unknown): string {
  const errors = (e as { errors?: { longMessage?: string; message?: string }[] })?.errors;
  const first = errors?.[0];
  return first?.longMessage ?? first?.message ?? (e instanceof Error ? e.message : String(e));
}

/**
 * Email/password auth via Clerk. Sign-up requires verifying the address with
 * a 6-digit code Clerk emails out; once the session is active, App.tsx takes
 * over and provisions the backend profile.
 */
export default function AuthScreen() {
  const { signIn, setActive: setActiveSignIn, isLoaded: signInLoaded } = useSignIn();
  const { signUp, setActive: setActiveSignUp, isLoaded: signUpLoaded } = useSignUp();

  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loaded = signInLoaded && signUpLoaded;
  // Light check only — Clerk does the real email validation and reports back.
  const credentialsReady = email.trim().includes("@") && password.length >= 8;

  const run = async (action: () => Promise<void>) => {
    if (busy || !loaded) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(clerkMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitSignIn = () =>
    run(async () => {
      const result = await signIn!.create({ identifier: email.trim(), password });
      if (result.status === "complete") {
        await setActiveSignIn!({ session: result.createdSessionId });
      } else {
        // Only possible with extra factors enabled in the Clerk dashboard,
        // which this app doesn't use.
        setError(`Unexpected sign-in state: ${result.status}`);
      }
    });

  const submitSignUp = () =>
    run(async () => {
      await signUp!.create({ emailAddress: email.trim(), password });
      await signUp!.prepareEmailAddressVerification({ strategy: "email_code" });
      setMode("verify");
    });

  const submitCode = () =>
    run(async () => {
      const result = await signUp!.attemptEmailAddressVerification({ code: code.trim() });
      if (result.status === "complete") {
        await setActiveSignUp!({ session: result.createdSessionId });
      } else {
        setError(`Unexpected verification state: ${result.status}`);
      }
    });

  const resendCode = () =>
    run(async () => {
      await signUp!.prepareEmailAddressVerification({ strategy: "email_code" });
    });

  if (mode === "verify") {
    return (
      <View style={styles.card}>
        <Reveal>
          <Text style={styles.eyebrow}>Verify</Text>
          <Text style={type.hero}>Check your email</Text>
          <Text style={[type.subtitle, styles.lede]}>
            Enter the 6-digit code sent to {email.trim()}
          </Text>
        </Reveal>

        <Reveal delay={90} style={styles.block}>
          <GlassSurface r={radius.lg} sunken>
            <TextInput
              style={[styles.input, styles.codeInput]}
              placeholder="000000"
              placeholderTextColor="rgba(255,255,255,0.13)"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              maxLength={6}
              autoFocus
              onSubmitEditing={submitCode}
            />
          </GlassSurface>
          <GlassButton
            label="Verify"
            onPress={submitCode}
            disabled={code.trim().length !== 6 || busy}
            busy={busy ? <ActivityIndicator color="#fff" /> : undefined}
          />
          {error && <Text style={styles.error}>{error}</Text>}
        </Reveal>

        <Reveal delay={160} style={styles.links}>
          <Pressable onPress={resendCode} disabled={busy} hitSlop={8}>
            <Text style={styles.link}>Resend code</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setMode("signUp");
              setCode("");
              setError(null);
            }}
            disabled={busy}
            hitSlop={8}
          >
            <Text style={styles.link}>Back</Text>
          </Pressable>
        </Reveal>
      </View>
    );
  }

  const signingIn = mode === "signIn";

  return (
    <View style={styles.card}>
      <Reveal>
        <Text style={styles.eyebrow}>{signingIn ? "Welcome back" : "First time"}</Text>
        {/* The wordmark is the one place the display face runs full width. */}
        <Text style={styles.wordmark}>Grupee</Text>
        <Text style={[type.subtitle, styles.lede]}>
          {signingIn
            ? "Sign in and find your crew in the crowd."
            : "Make an account and never lose anyone again."}
        </Text>
      </Reveal>

      <Reveal delay={90} style={styles.block}>
        <GlassSurface r={radius.md} sunken>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={color.textFaint}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
          />
        </GlassSurface>
        <GlassSurface r={radius.md} sunken>
          <TextInput
            style={styles.input}
            placeholder={signingIn ? "Password" : "Password (8+ characters)"}
            placeholderTextColor={color.textFaint}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType={signingIn ? "password" : "newPassword"}
            onSubmitEditing={signingIn ? submitSignIn : submitSignUp}
            returnKeyType="go"
          />
        </GlassSurface>
        <GlassButton
          label={signingIn ? "Sign in" : "Sign up"}
          onPress={signingIn ? submitSignIn : submitSignUp}
          disabled={!credentialsReady || busy || !loaded}
          busy={busy ? <ActivityIndicator color="#fff" /> : undefined}
        />
        {error && <Text style={styles.error}>{error}</Text>}
      </Reveal>

      <Reveal delay={160} style={styles.links}>
        <Pressable
          onPress={() => {
            setMode(signingIn ? "signUp" : "signIn");
            setError(null);
          }}
          disabled={busy}
          hitSlop={8}
        >
          <Text style={styles.link}>
            {signingIn ? "New here? Create an account" : "Already have an account? Sign in"}
          </Text>
        </Pressable>
      </Reveal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    justifyContent: "center",
    gap: space.xl,
    padding: space.xl,
  },
  eyebrow: {
    ...type.label,
    color: color.accentSoft,
    marginBottom: space.sm,
  },
  wordmark: {
    ...type.hero,
    fontSize: 42,
    lineHeight: 46,
    letterSpacing: -2,
  },
  lede: {
    marginTop: space.sm,
  },
  block: {
    gap: space.md,
  },
  links: {
    gap: space.xs,
  },
  input: {
    fontFamily: font.sansMedium,
    color: color.text,
    paddingHorizontal: space.lg,
    paddingVertical: 15,
    fontSize: 17,
  },
  codeInput: {
    fontFamily: font.monoBold,
    textAlign: "center",
    fontSize: 30,
    paddingVertical: 18,
    letterSpacing: 10,
    paddingLeft: 10,
  },
  link: {
    fontFamily: font.sansMedium,
    color: color.accentSoft,
    fontSize: 14,
    textAlign: "center",
    paddingVertical: space.sm,
  },
  error: {
    fontFamily: font.sansMedium,
    color: color.danger,
    fontSize: 14,
    textAlign: "center",
  },
});
