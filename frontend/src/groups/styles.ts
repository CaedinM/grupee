/**
 * One stylesheet for the whole groups flow. The screens here are steps in a
 * single flow and share their card/title/button look, so splitting these
 * per-file would mean duplicating the same primitives six times — a palette
 * tweak should stay a one-file edit.
 *
 * Surfaces are drawn by the Nightglass primitives in `../ui/Glass`, not here:
 * these rules position and set type, and never carry an opaque background,
 * because the app-wide Aurora has to show through.
 */
import { StyleSheet } from "react-native";

import { color, font, glass, radius, space, type } from "../ui/theme";

/** Avatars per row in a past-group card; wider crews wrap onto more rows. */
const PAST_MEMBERS_PER_ROW = 5;

export const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    flex: 1,
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    justifyContent: "center",
    gap: space.lg,
    padding: space.xl,
  },
  scroll: {
    flex: 1,
  },
  // Grows to fill the screen so the buttons can centre when there is no
  // history, but scrolls once past groups push it past the viewport.
  chooserContent: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    gap: space.md,
    padding: space.xl,
    paddingTop: 84,
    paddingBottom: space.xxl,
  },
  chooserContentCentered: {
    justifyContent: "center",
    paddingTop: space.xl,
  },
  // The create form can outgrow the viewport once a festival list arrives, so
  // it scrolls from the top rather than centring like the other steps.
  formContent: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    gap: space.md,
    padding: space.xl,
    paddingTop: 76,
    paddingBottom: space.xxl,
  },
  // Holds the back link at the top of a centred card without it stretching.
  backSlot: {
    position: "absolute",
    top: 68,
    left: space.xl,
  },
  groupContainer: {
    flex: 1,
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    gap: space.md,
    padding: space.xl,
    paddingTop: 76,
  },

  /* ------------------------------------------------------------- type */

  eyebrow: {
    ...type.label,
    color: color.accentSoft,
    marginBottom: space.sm,
  },
  title: type.title,
  subtitle: type.subtitle,
  sectionHeader: {
    ...type.label,
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  error: {
    fontFamily: font.sansMedium,
    color: color.danger,
    fontSize: 14,
  },

  /* ------------------------------------------------------------ inputs */

  input: {
    fontFamily: font.sansMedium,
    color: color.text,
    paddingHorizontal: space.lg,
    paddingVertical: 15,
    fontSize: 17,
  },
  // The join code is the one place the app uses mono at size — four glyphs on
  // a fixed grid, so the caret lands predictably as you type.
  codeInput: {
    fontFamily: font.monoBold,
    textAlign: "center",
    fontSize: 34,
    paddingVertical: 20,
    letterSpacing: 14,
    // The tracking is applied to the right of each glyph, so the string reads
    // off-centre without pulling it back.
    paddingLeft: 14,
  },

  /* ------------------------------------------------------------- code */

  codeBadge: {
    alignSelf: "flex-start",
  },
  codeBadgeBig: {
    alignSelf: "stretch",
  },
  codeBody: {
    alignItems: "center",
    paddingHorizontal: space.xl,
    paddingVertical: 14,
    gap: space.xs,
  },
  codeBodyBig: {
    paddingVertical: space.xxl,
    gap: space.md,
  },
  codeText: {
    fontFamily: font.monoBold,
    color: color.text,
    fontSize: 28,
    letterSpacing: 10,
    paddingLeft: 10,
  },
  codeTextBig: {
    fontSize: 54,
    letterSpacing: 18,
    paddingLeft: 18,
  },
  codeShareRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
  },
  codeShareHint: {
    fontFamily: font.sansMedium,
    color: color.accentSoft,
    fontSize: 11,
    letterSpacing: 0.3,
  },

  /* ---------------------------------------------------------- members */

  // The event chip and the join code share a row; the code keeps its intrinsic
  // width so the two read as a pair of tokens rather than a stack of bars.
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.sm,
  },
  // Takes the slack in the column so the roster — not the header — is what
  // scrolls when a crew outgrows the screen.
  memberSection: {
    flex: 1,
    marginTop: space.sm,
  },
  memberList: {
    flex: 1,
  },
  memberListBody: {
    padding: space.sm,
  },
  memberLoading: {
    padding: space.xl,
    alignItems: "center",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: 11,
  },
  memberAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.stroke,
  },
  memberAvatarEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  memberName: {
    fontFamily: font.sansMedium,
    color: color.text,
    fontSize: 15,
    flexShrink: 1,
  },
  memberYou: {
    fontFamily: font.sans,
    color: color.textFaint,
  },
  // Pushed to the right edge of the row; teal ties it to the landmark pins/pill
  // on the map. flexShrink lets a long landmark name truncate rather than shove
  // the member's name.
  memberLandmark: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    flexShrink: 1,
    paddingLeft: space.sm,
    paddingVertical: 4,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    backgroundColor: "rgba(94,234,212,0.10)",
  },
  memberLandmarkText: {
    fontFamily: font.sansSemi,
    color: color.teal,
    fontSize: 12,
    flexShrink: 1,
  },

  /* ------------------------------------------------------------- past */

  pastCard: {
    marginBottom: space.md,
  },
  pastBody: {
    padding: space.lg,
    gap: space.xs,
  },
  pastGroupName: {
    fontFamily: font.displayBold,
    color: color.text,
    fontSize: 19,
    letterSpacing: -0.5,
  },
  pastEventRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
  },
  pastEventName: {
    fontFamily: font.sansMedium,
    color: color.accentSoft,
    fontSize: 13,
    flexShrink: 1,
  },
  pastDates: {
    fontFamily: font.mono,
    color: color.textFaint,
    fontSize: 11,
    letterSpacing: -0.2,
  },
  pastMembersLoading: {
    alignSelf: "flex-start",
    marginTop: space.sm,
  },
  pastMemberGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: space.md,
  },
  pastMember: {
    // Five to a row; extra members wrap onto the next line.
    width: `${100 / PAST_MEMBERS_PER_ROW}%`,
    alignItems: "center",
    gap: space.xs,
    paddingHorizontal: 2,
    marginBottom: space.md,
  },
  pastMemberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.stroke,
  },
  pastMemberName: {
    fontFamily: font.sans,
    color: color.textDim,
    fontSize: 10,
    textAlign: "center",
    width: "100%",
  },

  /* ------------------------------------------------------------ event */

  eventOption: {
    marginBottom: space.sm,
  },
  eventOptionSelected: {
    borderWidth: 1,
    borderColor: "rgba(167,158,255,0.55)",
    borderRadius: radius.md,
  },
  eventOptionBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 15,
  },
  eventOptionText: {
    flex: 1,
    fontFamily: font.sansMedium,
    color: color.textDim,
    fontSize: 15,
  },
  eventOptionTextSelected: {
    fontFamily: font.sansSemi,
    color: color.text,
  },
  eventChip: {
    alignSelf: "flex-start",
  },
  eventChipBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: 7,
  },
  eventChipText: {
    fontFamily: font.sansSemi,
    color: color.accentSoft,
    fontSize: 12.5,
  },

  /* ------------------------------------------------------------- misc */

  backLink: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingRight: space.md,
    paddingVertical: space.xs,
  },
  backText: {
    fontFamily: font.sansMedium,
    color: color.accentSoft,
    fontSize: 14,
  },
  leaveButton: {
    marginTop: "auto",
    alignSelf: "center",
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
  },
  leaveText: {
    fontFamily: font.sansSemi,
    color: color.danger,
    fontSize: 14,
  },
});
