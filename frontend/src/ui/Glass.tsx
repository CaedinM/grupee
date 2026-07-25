/**
 * The Nightglass primitives. Everything visual outside the map is built from
 * these four pieces, so a change to how glass looks is a change to this file.
 *
 * The recipe for a pane, in back-to-front order, is what sells the material:
 *   1. a BlurView, which refracts the `Aurora` behind it
 *   2. a near-transparent white wash, so the pane has a body
 *   3. a `sheen` — light falling from the top edge into the pane
 *   4. a specular hairline along the top rim, brightest left of centre
 *   5. a hairline border and a wide soft shadow, so it reads as floating
 *
 * Steps 3–4 are the difference between "liquid glass" and "a translucent box";
 * don't drop them when composing new surfaces.
 */
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { ReactNode, useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";

import { color, glass, radius, ramp, shadow, type } from "./theme";

/* ------------------------------------------------------------------ Aurora */

/**
 * The festival light every pane refracts. Painted once, app-wide, behind the
 * screen stack — panes have no colour of their own, so without this the whole
 * UI collapses to flat grey.
 *
 * expo-linear-gradient has no radial mode, so each bloom is an oversized round
 * view holding a gradient that fades to transparent; a full-bleed BlurView on
 * top melts the remaining edges into one another.
 */
export function Aurora() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={["#0B0917", "#07070B", "#080B12"]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      <Bloom
        colors={["rgba(134,86,255,0.55)", "rgba(134,86,255,0)"]}
        style={{ top: -190, left: -140, width: 520, height: 520 }}
      />
      <Bloom
        colors={["rgba(255,77,141,0.30)", "rgba(255,77,141,0)"]}
        style={{ top: 90, right: -200, width: 460, height: 460 }}
      />
      <Bloom
        colors={["rgba(56,189,248,0.26)", "rgba(56,189,248,0)"]}
        style={{ bottom: -170, left: -110, width: 500, height: 500 }}
      />
      <Bloom
        colors={["rgba(168,85,247,0.30)", "rgba(168,85,247,0)"]}
        style={{ bottom: -120, right: -140, width: 420, height: 420 }}
      />
      {/* Melts the blooms' remaining hard edges into a single field of light. */}
      <BlurView
        intensity={90}
        tint="dark"
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      {/* Sinks the corners so the light reads as coming from behind the glass. */}
      <LinearGradient
        colors={["rgba(7,7,11,0.55)", "rgba(7,7,11,0)", "rgba(7,7,11,0.75)"]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

function Bloom({
  colors,
  style,
}: {
  colors: readonly [string, string];
  style: ViewStyle;
}) {
  return (
    <View style={[styles.bloom, style]}>
      <LinearGradient
        colors={colors}
        start={{ x: 0.35, y: 0.15 }}
        end={{ x: 0.75, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/* ------------------------------------------------------------------- Panes */

export type GlassProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Corner radius; also clips the blur. Defaults to `radius.lg`. */
  r?: number;
  /** Blur strength. Lower for surfaces stacked inside another pane. */
  intensity?: number;
  /** Brighter wash — for the one pane on a screen that should lead. */
  raised?: boolean;
  /** Darker wash — for wells that sit *inside* a pane (inputs, lists). */
  sunken?: boolean;
  /** Suppress the top-edge light. Off for small pills inside a lit pane. */
  sheen?: boolean;
  /**
   * Opacity of a black underlay beneath the white wash, for glass that floats
   * over something bright rather than over the Aurora — the map chrome, whose
   * backdrop is a light `mutedStandard` map. Without it, light text on a blur
   * of a pale map has no contrast. 0 (off) everywhere else.
   */
  scrim?: number;
};

/**
 * The base pane. Shadow and clipping have to live on different views — a view
 * with `overflow: hidden` drops its own iOS shadow — hence the outer/inner pair.
 */
export function GlassSurface({
  children,
  style,
  r = radius.lg,
  intensity = 42,
  raised = false,
  sunken = false,
  sheen = true,
  scrim = 0,
}: GlassProps) {
  return (
    <View style={[{ borderRadius: r }, shadow.pane, style]}>
      <View style={[styles.clip, { borderRadius: r }]}>
        <BlurView
          intensity={intensity}
          tint="systemUltraThinMaterialDark"
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
        {scrim > 0 && (
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(9,9,14,${scrim})` }]}
          />
        )}
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: sunken
                ? glass.fillSunken
                : raised
                  ? glass.fillStrong
                  : glass.fill,
            },
          ]}
        />
        {sheen && (
          <LinearGradient
            colors={ramp.sheen}
            style={[styles.sheen, { borderTopLeftRadius: r, borderTopRightRadius: r }]}
            pointerEvents="none"
          />
        )}
        {sheen && <Specular />}
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.hairline,
            { borderRadius: r, borderColor: sunken ? glass.strokeSoft : glass.stroke },
          ]}
          pointerEvents="none"
        />
        {children}
      </View>
    </View>
  );
}

/** The lit rim. Brightest just left of centre, as if the light source is there. */
function Specular() {
  return (
    <LinearGradient
      colors={ramp.specular}
      locations={[0, 0.38, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={styles.specular}
      pointerEvents="none"
    />
  );
}

/** A pane with the standard interior padding. */
export function GlassCard({ children, style, ...rest }: GlassProps) {
  return (
    <GlassSurface {...rest} style={style}>
      <View style={styles.cardBody}>{children}</View>
    </GlassSurface>
  );
}

/* --------------------------------------------------------------- Pressables */

/**
 * Springs a view down on press. Glass has no hover and no colour change to
 * lean on, so scale is what makes it feel physical.
 */
export function usePressScale(to = 0.96) {
  const scale = useRef(new Animated.Value(1)).current;
  const spring = (v: number) =>
    Animated.spring(scale, {
      toValue: v,
      useNativeDriver: true,
      speed: 40,
      bounciness: 6,
    }).start();
  return {
    scale,
    onPressIn: () => spring(to),
    onPressOut: () => spring(1),
  };
}

type ButtonProps = Omit<PressableProps, "style"> & {
  label: string;
  /** `primary` is the accent gradient; `glass` is a plain pane. */
  variant?: "primary" | "glass";
  icon?: ReactNode;
  /** Replaces the label — for spinners. */
  busy?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function GlassButton({
  label,
  variant = "primary",
  icon,
  busy,
  style,
  disabled,
  ...rest
}: ButtonProps) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  const primary = variant === "primary";

  return (
    <Animated.View
      style={[
        { transform: [{ scale }], borderRadius: radius.pill },
        primary ? shadow.accent : shadow.pane,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Pressable
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={disabled}
        style={[styles.clip, styles.button, { borderRadius: radius.pill }]}
        {...rest}
      >
        {primary ? (
          <LinearGradient
            colors={ramp.accent}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <>
            <BlurView
              intensity={40}
              tint="systemUltraThinMaterialDark"
              experimentalBlurMethod="dimezisBlurView"
              style={StyleSheet.absoluteFill}
            />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: glass.fillStrong }]} />
          </>
        )}
        <LinearGradient
          colors={ramp.sheen}
          style={styles.buttonSheen}
          pointerEvents="none"
        />
        <Specular />
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.hairline,
            {
              borderRadius: radius.pill,
              borderColor: primary ? glass.strokeBright : glass.stroke,
            },
          ]}
          pointerEvents="none"
        />
        {busy ?? (
          <View style={styles.buttonRow}>
            {icon}
            <Text style={type.button}>{label}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------- Motion */

/**
 * Staggered entrance. Only worth using where something genuinely mounts — the
 * four tab screens stay mounted for the map's sake, so this belongs on the
 * groups flow's steps, the settings sheet, and lists that re-key on a filter.
 */
export function Reveal({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(t, {
      toValue: 1,
      duration: 460,
      delay,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [delay, t]);

  return (
    <Animated.View
      style={[
        {
          opacity: t,
          transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** The breathing halo behind a "now playing" dot. */
export function PulseDot({ color: dotColor = color.magenta }: { color?: string }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, {
          toValue: 1,
          duration: 1400,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [t]);

  return (
    <View style={styles.pulseWrap}>
      <Animated.View
        style={[
          styles.pulseHalo,
          {
            backgroundColor: dotColor,
            opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
            transform: [
              { scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] }) },
            ],
          },
        ]}
      />
      <View style={[styles.pulseCore, { backgroundColor: dotColor }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  bloom: {
    position: "absolute",
    borderRadius: 9999,
    overflow: "hidden",
  },
  clip: {
    overflow: "hidden",
  },
  hairline: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  sheen: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 76,
  },
  specular: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 1,
  },
  cardBody: {
    padding: 18,
  },
  button: {
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonSheen: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 26,
  },
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  disabled: {
    opacity: 0.38,
  },
  pulseWrap: {
    width: 8,
    height: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  pulseHalo: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pulseCore: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
