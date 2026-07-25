/**
 * "Nightglass" — the design tokens for every screen except the map.
 *
 * The premise: the app is a slab of smoked glass held up against festival
 * light. `Aurora` (see Glass.tsx) paints that light once, app-wide, behind
 * everything; every surface above it is a lens that blurs and refracts it.
 * So surfaces here are deliberately *translucent* — they have no opaque
 * background of their own, and a token like `glass.fill` is a wash meant to
 * sit on top of a BlurView, never a standalone backgroundColor.
 *
 * The map is exempt: `MapScreen` owns its own opaque palette and is not
 * themed from this file.
 */
import { Platform, TextStyle } from "react-native";

/**
 * Type is split by family-per-weight rather than fontWeight, because a custom
 * fontFamily plus fontWeight makes Android pick a synthesized face. Every text
 * style below therefore sets `fontFamily` and never `fontWeight`.
 */
export const font = {
  /** Bricolage Grotesque — display only: screen titles, names, artists. */
  display: "BricolageGrotesque_800ExtraBold",
  displayBold: "BricolageGrotesque_700Bold",
  displaySemi: "BricolageGrotesque_600SemiBold",
  /** Geist — everything the user reads as UI rather than as a headline. */
  sans: "Geist_400Regular",
  sansMedium: "Geist_500Medium",
  sansSemi: "Geist_600SemiBold",
  sansBold: "Geist_700Bold",
  /** Geist Mono — join codes, set times, ids: anything that wants to align. */
  mono: "GeistMono_500Medium",
  monoBold: "GeistMono_700Bold",
} as const;

export const color = {
  /** The substrate the aurora is painted on. */
  void: "#07070B",
  text: "#F6F5FC",
  textDim: "#A6A3BA",
  textFaint: "#6F6C84",
  /** Primary accent, and the two hues the aurora and gradients run between. */
  accent: "#6E6BFF",
  accentSoft: "#A79EFF",
  violet: "#A855F7",
  /** Live / now-playing energy. */
  magenta: "#FF4D8D",
  /** Landmarks — kept from the old palette so the map and this agree. */
  teal: "#5EEAD4",
  danger: "#FF7A7A",
} as const;

/**
 * Washes layered *over* a BlurView. Alpha values are low on purpose: the blur
 * supplies the substance, these only tint it and catch the light.
 */
export const glass = {
  fill: "rgba(255,255,255,0.055)",
  fillStrong: "rgba(255,255,255,0.09)",
  fillSunken: "rgba(0,0,0,0.18)",
  stroke: "rgba(255,255,255,0.11)",
  strokeSoft: "rgba(255,255,255,0.06)",
  strokeBright: "rgba(255,255,255,0.22)",
} as const;

/** Gradient ramps. Tuples are `as const` so they satisfy LinearGradient's type. */
export const ramp = {
  accent: ["#7B78FF", "#A855F7"] as const,
  accentPressed: ["#6360E8", "#9040DE"] as const,
  live: ["#FF4D8D", "#A855F7"] as const,
  /** The specular hairline that runs the top rim of every pane. */
  specular: [
    "rgba(255,255,255,0)",
    "rgba(255,255,255,0.55)",
    "rgba(255,255,255,0.08)",
  ] as const,
  /** The sheen falling from the top edge into the body of a pane. */
  sheen: ["rgba(255,255,255,0.13)", "rgba(255,255,255,0)"] as const,
} as const;

export const radius = {
  sm: 14,
  md: 20,
  lg: 28,
  xl: 34,
  pill: 999,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/**
 * Glass needs a soft, wide, low-opacity drop shadow to read as *floating*
 * rather than as a flat translucent rectangle. Android gets elevation instead.
 */
export const shadow = {
  pane: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOpacity: 0.5,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
    },
    default: { elevation: 8 },
  })!,
  floating: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOpacity: 0.6,
      shadowRadius: 32,
      shadowOffset: { width: 0, height: 18 },
    },
    default: { elevation: 16 },
  })!,
  /** For the accent gradient buttons — coloured, so the button glows. */
  accent: Platform.select({
    ios: {
      shadowColor: "#6E6BFF",
      shadowOpacity: 0.5,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 10 },
    },
    default: { elevation: 10 },
  })!,
} as const;

/** The shared type scale. Screens compose these rather than re-deriving sizes. */
export const type = {
  hero: {
    fontFamily: font.display,
    fontSize: 38,
    lineHeight: 42,
    letterSpacing: -1.4,
    color: color.text,
  },
  title: {
    fontFamily: font.display,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -1,
    color: color.text,
  },
  subtitle: {
    fontFamily: font.sans,
    fontSize: 16,
    lineHeight: 23,
    color: color.textDim,
  },
  /** Small all-caps section markers — the connective tissue of every screen. */
  label: {
    fontFamily: font.sansSemi,
    fontSize: 11,
    letterSpacing: 1.7,
    textTransform: "uppercase",
    color: color.textFaint,
  } as TextStyle,
  body: {
    fontFamily: font.sans,
    fontSize: 15,
    lineHeight: 21,
    color: color.text,
  },
  bodyStrong: {
    fontFamily: font.sansMedium,
    fontSize: 15,
    lineHeight: 21,
    color: color.text,
  },
  button: {
    fontFamily: font.sansSemi,
    fontSize: 16,
    letterSpacing: -0.2,
    color: color.text,
  },
} as const;
