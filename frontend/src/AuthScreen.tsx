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
        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.subtitle}>
          Enter the 6-digit code sent to {email.trim()}
        </Text>
        <TextInput
          style={[styles.input, styles.codeInput]}
          placeholder="000000"
          placeholderTextColor="#55555f"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          maxLength={6}
          autoFocus
          onSubmitEditing={submitCode}
        />
        <Pressable
          style={[styles.button, (code.trim().length !== 6 || busy) && styles.buttonDisabled]}
          onPress={submitCode}
          disabled={code.trim().length !== 6 || busy}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify</Text>}
        </Pressable>
        {error && <Text style={styles.error}>{error}</Text>}
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
      </View>
    );
  }

  const signingIn = mode === "signIn";

  return (
    <View style={styles.card}>
      <Text style={styles.title}>WhereTheyAt</Text>
      <Text style={styles.subtitle}>
        {signingIn ? "Welcome back — sign in to find your crew" : "Create an account to get started"}
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor="#55555f"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
      />
      <TextInput
        style={styles.input}
        placeholder={signingIn ? "Password" : "Password (8+ characters)"}
        placeholderTextColor="#55555f"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType={signingIn ? "password" : "newPassword"}
        onSubmitEditing={signingIn ? submitSignIn : submitSignUp}
        returnKeyType="go"
      />
      <Pressable
        style={[styles.button, (!credentialsReady || busy || !loaded) && styles.buttonDisabled]}
        onPress={signingIn ? submitSignIn : submitSignUp}
        disabled={!credentialsReady || busy || !loaded}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{signingIn ? "Sign in" : "Sign up"}</Text>
        )}
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
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
    </View>
  );
}

const styles = StyleSheet.create({
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
  codeInput: {
    textAlign: "center",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 10,
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
  link: {
    color: "#8b8bf5",
    fontSize: 15,
    textAlign: "center",
    paddingVertical: 4,
  },
  error: {
    color: "#ff6b6b",
    fontSize: 14,
    textAlign: "center",
  },
});
