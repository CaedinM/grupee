/**
 * The three families the Nightglass type scale names in `theme.ts`. Loaded
 * once at the App root; every `fontFamily` token is inert until this resolves,
 * so the root holds the UI back until `ready` (see App.tsx).
 */
import {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from "@expo-google-fonts/bricolage-grotesque";
import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
} from "@expo-google-fonts/geist";
import { GeistMono_500Medium, GeistMono_700Bold } from "@expo-google-fonts/geist-mono";
import { useFonts } from "expo-font";

export function useNightglassFonts(): boolean {
  const [loaded, error] = useFonts({
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    GeistMono_500Medium,
    GeistMono_700Bold,
  });
  // A font that fails to load must not wedge the app on a blank screen — fall
  // back to the system face and carry on.
  return loaded || error !== null;
}
