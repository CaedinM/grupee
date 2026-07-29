/**
 * Everything that decides how a landmark kind is *drawn*: its glyph, its
 * prominence, and its colour. Shared by the in-map pin (`LandmarkMarker`) and
 * the header landmark pill, so a kind looks the same wherever it appears.
 *
 * Note this module is map cartography, not Nightglass — the colours here are
 * tuned to read against Apple's pale `mutedStandard` tiles, not against the
 * Aurora, so it deliberately does not import `src/ui/theme`. See AGENTS.md.
 */
import { Ionicons } from "@expo/vector-icons";
import { SymbolView, type SFSymbol } from "expo-symbols";

import type { LandmarkKind } from "../api";

/**
 * SF Symbols per landmark kind — the iOS-native icon language. `SFSymbol` is a
 * strict union, so a typo here is a compile error rather than a pin that
 * silently renders empty on device. Every name below is SF Symbols 4.0 or
 * lower (iOS 16.0), under the project's 16.4 deployment target.
 */
export const LANDMARK_SYMBOLS: Record<LandmarkKind, SFSymbol> = {
  stage: "music.mic",
  entrance: "figure.walk.arrival",
  exit: "figure.walk.departure",
  restroom: "figure.dress.line.vertical.figure",
  food: "fork.knife",
  drinks: "wineglass.fill",
  medical: "cross.case.fill",
  meetup: "person.2.fill",
  other: "mappin",
};

/**
 * The Ionicons equivalent, rendered on Android and web where SF Symbols don't
 * exist. Falls back to a generic pin for anything the server adds before this
 * map does.
 */
export const LANDMARK_ICONS: Record<LandmarkKind, keyof typeof Ionicons.glyphMap> = {
  stage: "musical-notes",
  entrance: "log-in",
  exit: "log-out",
  restroom: "male-female",
  food: "restaurant",
  drinks: "beer",
  medical: "medkit",
  meetup: "flag",
  other: "location",
};

/**
 * How loudly a kind is drawn on the map. Stages are the reason anyone opens
 * this screen; toilets should recede until you're looking for one.
 *
 * - `primary`   — tailed gradient pin, large label
 * - `secondary` — solid circle, label
 * - `tertiary`  — small dot, no label at all
 */
export type PinTier = "primary" | "secondary" | "tertiary";

export const PIN_TIERS: Record<LandmarkKind, PinTier> = {
  stage: "primary",
  medical: "secondary",
  food: "secondary",
  drinks: "secondary",
  meetup: "secondary",
  entrance: "secondary",
  exit: "secondary",
  restroom: "tertiary",
  other: "tertiary",
};

/** Map palette. Distinct from members (orange) and self (indigo). */
export const PIN_COLORS = {
  /** Landmark teal — the same hue the landmark pills and member rows use. */
  teal: "#14b8a6",
  /** Medical stands out in red. */
  medical: "#ef4444",
  /** Currently-playing stage. */
  live: "#FF4D8D",
  /** The primary pin's gradient, violet → indigo. */
  stageGradient: ["#8B5CF6", "#5B5BF0"] as const,
  /** Flat equivalent of `stageGradient`, for the shadow path under it. */
  stage: "#6E5BF4",
  ring: "rgba(255, 255, 255, 0.95)",
  /** Label halo, so text stays legible over the muted map. */
  halo: "rgba(255, 255, 255, 0.9)",
} as const;

export function pinColorFor(kind: LandmarkKind): string {
  return kind === "medical" ? PIN_COLORS.medical : PIN_COLORS.teal;
}

/**
 * One landmark glyph, SF Symbol on iOS and Ionicons everywhere else.
 * `SymbolView`'s own `fallback` prop handles the platform split, so callers
 * never branch on `Platform.OS`.
 *
 * `SymbolView` sizes itself from its style box rather than a `size` prop, so
 * the square is set explicitly and the symbol's own `size` is left alone.
 */
export function LandmarkGlyph({
  kind,
  size,
  color,
}: {
  kind: LandmarkKind;
  size: number;
  color: string;
}) {
  return (
    <SymbolView
      name={LANDMARK_SYMBOLS[kind] ?? "mappin"}
      tintColor={color}
      // Semibold: these render at 11–20px over a busy map, and the default
      // weight gets lost against building fills at that size.
      weight="semibold"
      resizeMode="scaleAspectFit"
      style={{ width: size, height: size }}
      fallback={<Ionicons name={LANDMARK_ICONS[kind] ?? "location"} size={size} color={color} />}
    />
  );
}
