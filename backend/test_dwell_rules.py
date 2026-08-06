#!/usr/bin/env python
"""Dwell-rule tests — the pure half of set attendance.

`attendance._advance` is deliberately free of Redis, the database, and the clock,
so the rules that decide whether someone saw a set can be exercised directly:

    python test_dwell_rules.py

No server, no Redis, no database. `smoke_test.sh` still covers the wiring around
it (auth, ingest, the read endpoint); this covers the logic those paths share.

Kept as plain asserts rather than pytest to match the repo — there is no test
runner here, and adding one for a single file isn't worth the dependency.
"""
import sys

from app.attendance import MAX_PING_GAP_SECONDS, SEEN_DWELL_SECONDS, _advance

failures: list[str] = []


def check(label: str, condition: bool) -> None:
    print(f"  {'ok  ' if condition else 'FAIL'} {label}")
    if not condition:
        failures.append(label)


def segment(dwell: float, *, credited: bool = False, set_id: str = "setA") -> dict:
    return {
        "set_id": set_id,
        "dwell": dwell,
        "last_seen": 2000.0,
        "first_seen": 1000.0,
        "inside": True,
        "credited": credited,
    }


print(f"thresholds: SEEN={SEEN_DWELL_SECONDS}s  MAX_GAP={MAX_PING_GAP_SECONDS}s\n")

print("A position with nothing to track")
state, credit = _advance(None, None, 1000.0)
check("wandering the field writes nothing", state is None and credit is None)

print("\nOpening and growing a segment")
state, credit = _advance(None, "setA", 1000.0)
check(
    "first sighting opens a segment at zero",
    state["set_id"] == "setA"
    and state["dwell"] == 0.0
    and state["inside"]
    and not state["credited"]
    and credit is None,
)
state, credit = _advance(state, "setA", 1100.0)
check("a 100s gap accumulates", state["dwell"] == 100.0 and credit is None)

print("\nLeaving and coming back — time outside is never credited")
state, credit = _advance(state, None, 1150.0)
check(
    "leaving closes the segment but keeps the total",
    state["inside"] is False and state["dwell"] == 100.0 and credit is None,
)
still_out, _ = _advance(state, None, 1200.0)
check("staying outside writes nothing further", still_out is None)
state, credit = _advance(state, "setA", 1400.0)
check(
    "re-entry credits none of the 250s spent away",
    state["dwell"] == 100.0 and state["inside"] is True and credit is None,
)

print("\nSilence we can't vouch for")
state, credit = _advance(state, "setA", 1400.0 + MAX_PING_GAP_SECONDS + 1)
check(
    "a gap past MAX_PING_GAP credits nothing but keeps the total",
    state["dwell"] == 100.0 and credit is None,
)

print("\nCrossing the threshold")
state, credit = _advance(segment(SEEN_DWELL_SECONDS - 10), "setA", 2020.0)
check(
    "crossing the threshold produces a credit",
    credit is not None
    and credit.dwell_seconds >= SEEN_DWELL_SECONDS
    and state["credited"] is True,
)
check("the credit carries first_seen_at", credit.first_seen_at.timestamp() == 1000.0)
_, again = _advance(state, "setA", 2040.0)
check("an already-credited segment never credits twice", again is None)
_, early = _advance(segment(SEEN_DWELL_SECONDS - 100), "setA", 2010.0)
check("short of the threshold credits nothing", early is None)

print("\nSet changeover forfeits both halves")
state, credit = _advance(segment(SEEN_DWELL_SECONDS - 10), "setB", 2010.0)
check(
    "a different set resets the counter to zero",
    state["set_id"] == "setB" and state["dwell"] == 0.0 and credit is None,
)

print("\nDegenerate input (a corrupt or half-written Redis value)")
state, credit = _advance({"set_id": "setA"}, "setA", 3000.0)
check("missing fields are tolerated", state is not None and credit is None)

print()
if failures:
    print(f"❌ {len(failures)} check(s) failed: {failures}")
    sys.exit(1)
print("✅ All dwell-rule checks passed.")
