/**
 * One stylesheet for the whole groups flow. The screens here are steps in a
 * single flow and share their card/title/button look, so splitting these
 * per-file would mean duplicating the same primitives six times — a palette
 * tweak should stay a one-file edit.
 */
import { StyleSheet } from "react-native";

/** Avatars per row in a past-group card; wider crews wrap onto more rows. */
const PAST_MEMBERS_PER_ROW = 6;

export const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: "#101014",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    flex: 1,
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
    backgroundColor: "#101014",
  },
  scroll: {
    flex: 1,
    backgroundColor: "#101014",
  },
  // Grows to fill the screen so the buttons can centre when there is no
  // history, but scrolls once past groups push it past the viewport.
  chooserContent: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    gap: 12,
    padding: 24,
    paddingTop: 72,
    paddingBottom: 40,
  },
  chooserContentCentered: {
    justifyContent: "center",
    paddingTop: 24,
  },
  groupContainer: {
    flex: 1,
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    gap: 12,
    padding: 24,
    paddingTop: 72,
    backgroundColor: "#101014",
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
  },
  subtitle: {
    fontSize: 16,
    color: "#9a9aa5",
  },
  sectionHeader: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: "700",
    color: "#71717c",
    textTransform: "uppercase",
    letterSpacing: 1,
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
    letterSpacing: 12,
  },
  button: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#5b5bf0",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonSecondary: {
    backgroundColor: "#2a2a32",
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
  codeBadge: {
    alignSelf: "flex-start",
    alignItems: "center",
    backgroundColor: "#1c1c22",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2a2a32",
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 2,
  },
  codeBadgeBig: {
    alignSelf: "center",
    paddingHorizontal: 32,
    paddingVertical: 18,
  },
  codeText: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: 8,
  },
  codeTextBig: {
    fontSize: 44,
    letterSpacing: 14,
  },
  codeShareRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  codeShareHint: {
    color: "#8b8bf5",
    fontSize: 12,
  },
  memberList: {
    backgroundColor: "#1c1c22",
    borderRadius: 12,
    padding: 8,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  memberAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#2a2a32",
  },
  memberAvatarEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  pastCard: {
    backgroundColor: "#1c1c22",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2a2a32",
    padding: 16,
    gap: 6,
  },
  pastGroupName: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  pastEventRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pastEventName: {
    color: "#8b8bf5",
    fontSize: 14,
    fontWeight: "600",
    flexShrink: 1,
  },
  pastDates: {
    color: "#71717c",
    fontSize: 13,
  },
  pastMembersLoading: {
    alignSelf: "flex-start",
    marginTop: 8,
  },
  pastMemberGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
  },
  pastMember: {
    // Six to a row; extra members wrap onto the next line.
    width: `${100 / PAST_MEMBERS_PER_ROW}%`,
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 2,
    marginBottom: 10,
  },
  pastMemberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#2a2a32",
  },
  pastMemberName: {
    color: "#9a9aa5",
    fontSize: 10,
    textAlign: "center",
    width: "100%",
  },
  memberName: {
    color: "#fff",
    fontSize: 16,
    flexShrink: 1,
  },
  roleBadge: {
    backgroundColor: "rgba(91, 91, 240, 0.2)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  roleBadgeText: {
    color: "#8b8bf5",
    fontSize: 12,
    fontWeight: "600",
  },
  leaveButton: {
    marginTop: "auto",
    alignSelf: "center",
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  leaveText: {
    color: "#ff6b6b",
    fontSize: 15,
    fontWeight: "600",
  },
  eventOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#1c1c22",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2a2a32",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  eventOptionSelected: {
    borderColor: "#5b5bf0",
    backgroundColor: "rgba(91, 91, 240, 0.12)",
  },
  eventOptionText: {
    flex: 1,
    color: "#c5c5cf",
    fontSize: 16,
  },
  eventOptionTextSelected: {
    color: "#fff",
    fontWeight: "600",
  },
  eventChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(91, 91, 240, 0.15)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  eventChipText: {
    color: "#8b8bf5",
    fontSize: 13,
    fontWeight: "600",
  },
  backLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  backText: {
    color: "#8b8bf5",
    fontSize: 15,
  },
  error: {
    color: "#ff6b6b",
    fontSize: 14,
  },
});
