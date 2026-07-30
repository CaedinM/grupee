import { SignedIn, SignedOut, SignIn, useAuth, useUser } from "@clerk/clerk-react";
import { useCallback, useEffect, useState } from "react";

import { ApiError, getMe, listEvents, type AdminUser, type FestivalEvent } from "./api";
import CreateEvent from "./CreateEvent";
import EventDashboard from "./EventDashboard";
import EventSets from "./EventSets";

export default function App() {
  return (
    <div className="atmosphere">
      <SignedOut>
        <LoginPage />
      </SignedOut>
      <SignedIn>
        <AdminGate />
      </SignedIn>
    </div>
  );
}

function LoginPage() {
  return (
    <main className="login">
      <header className="brand">
        <div className="brand-row">
          <h1 className="wordmark">Grupee</h1>
          <span className="ops-badge">OPS</span>
        </div>
        <p className="brand-sub">Observe usage · create events · set geofences</p>
      </header>
      {/* hash routing keeps the multi-step flows (email code, password reset)
          working without a router */}
      <SignIn routing="hash" />
      <p className="coords">CTRL ROOM // AUTH REQUIRED</p>
    </main>
  );
}

type GateState =
  | { status: "loading" }
  | { status: "no-profile" }
  | { status: "error"; message: string }
  | { status: "denied"; user: AdminUser }
  | { status: "ready"; user: AdminUser };

/** Post-login gate: the backend, not Clerk, decides who is an admin
 *  (users.is_admin, granted only by direct DB update). */
function AdminGate() {
  const { getToken, signOut } = useAuth();
  const { user: account } = useUser();
  const [state, setState] = useState<GateState>({ status: "loading" });

  const check = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const token = await getToken();
      if (!token) throw new Error("No session token");
      const me = await getMe(token);
      setState(me.is_admin ? { status: "ready", user: me } : { status: "denied", user: me });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setState({ status: "no-profile" });
      } else {
        setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
      }
    }
  }, [getToken]);

  useEffect(() => {
    check();
  }, [check]);

  const email = account?.primaryEmailAddress?.emailAddress;

  if (state.status === "loading") {
    return (
      <main className="center">
        <div className="spinner" />
        <p className="status-tag">CHECKING ACCESS</p>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="center">
        <p className="status-tag error">BACKEND UNREACHABLE</p>
        <h2>Couldn't verify access</h2>
        <p>{state.message}</p>
        <button className="primary" onClick={check}>
          Retry
        </button>
        <button className="ghost" onClick={() => signOut()}>
          Sign out
        </button>
      </main>
    );
  }

  if (state.status === "no-profile") {
    return (
      <main className="center">
        <p className="status-tag error">NO PROFILE</p>
        <h2>This account has no Grupee profile yet</h2>
        <p>
          Sign in to the phone app once with {email ?? "this account"} to create it, then grant
          admin in the database and come back.
        </p>
        <button className="primary" onClick={check}>
          Check again
        </button>
        <button className="ghost" onClick={() => signOut()}>
          Sign out
        </button>
      </main>
    );
  }

  if (state.status === "denied") {
    return (
      <main className="center">
        <p className="status-tag error">ACCESS DENIED</p>
        <h2>{state.user.display_name} is not an admin</h2>
        <p>
          Admin access is granted directly in the database, not through sign-up. Flip{" "}
          <code>users.is_admin</code> for this account, then check again.
        </p>
        <span className="mono-id">{state.user.id}</span>
        <button className="primary" onClick={check}>
          Check again
        </button>
        <button className="ghost" onClick={() => signOut()}>
          Sign out
        </button>
      </main>
    );
  }

  return (
    <Shell user={state.user} email={email} getToken={getToken} onSignOut={() => signOut()} />
  );
}

type View =
  | { kind: "list" }
  | { kind: "dashboard"; event: FestivalEvent }
  | { kind: "sets"; event: FestivalEvent }
  | { kind: "create" }
  | { kind: "edit"; event: FestivalEvent };

function Shell({
  user,
  email,
  getToken,
  onSignOut,
}: {
  user: AdminUser;
  email: string | undefined;
  getToken: () => Promise<string | null>;
  onSignOut: () => void;
}) {
  // What's on screen: the list, an event's dashboard, or the create/edit form.
  const [view, setView] = useState<View>({ kind: "list" });
  const [events, setEvents] = useState<FestivalEvent[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  // Re-tick so an event moves between Live/Upcoming/Past while the page sits open.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const refreshEvents = useCallback(async () => {
    setEventsError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Session expired — sign in again");
      setEvents(await listEvents(token));
    } catch (e) {
      setEventsError(e instanceof Error ? e.message : String(e));
    }
  }, [getToken]);

  useEffect(() => {
    refreshEvents();
  }, [refreshEvents]);

  if (view.kind === "create" || view.kind === "edit") {
    const editing = view.kind === "edit" ? view.event : undefined;
    return (
      <CreateEvent
        getToken={getToken}
        initial={editing}
        // Cancelling an edit returns to that event's dashboard; a create returns to the list.
        onCancel={() => setView(editing ? { kind: "dashboard", event: editing } : { kind: "list" })}
        onCreated={(saved) => {
          setView(editing ? { kind: "dashboard", event: saved } : { kind: "list" });
          refreshEvents();
        }}
      />
    );
  }

  if (view.kind === "dashboard" || view.kind === "sets") {
    const topbar = (
      <header className="topbar">
        <div className="topbar-brand">
          <h1 className="wordmark">Grupee</h1>
          <span className="ops-badge">OPS</span>
        </div>
        <div className="topbar-user">
          <span>{email ?? user.display_name}</span>
          <button className="ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>
    );
    if (view.kind === "sets") {
      return (
        <>
          {topbar}
          <EventSets
            event={view.event}
            getToken={getToken}
            onBack={() => setView({ kind: "dashboard", event: view.event })}
          />
        </>
      );
    }
    return (
      <>
        {topbar}
        <EventDashboard
          event={view.event}
          onEdit={() => setView({ kind: "edit", event: view.event })}
          onManageSets={() => setView({ kind: "sets", event: view.event })}
          onBack={() => setView({ kind: "list" })}
        />
      </>
    );
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-brand">
          <h1 className="wordmark">Grupee</h1>
          <span className="ops-badge">OPS</span>
        </div>
        <div className="topbar-user">
          <span>{email ?? user.display_name}</span>
          <button className="ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="home">
        <div className="home-header">
          <p className="status-tag">ADMIN · {user.display_name.toUpperCase()}</p>
          <h2>Events</h2>
          <button className="primary" onClick={() => setView({ kind: "create" })}>
            Create New Event
          </button>
        </div>
        {eventsError && <p className="field-error">{eventsError}</p>}
        {events && events.length === 0 && <p className="home-empty">No events yet.</p>}
        {events &&
          events.length > 0 &&
          groupEvents(events, now).map(({ key, label, events: group }) => (
            <section key={key} className={`event-group ${key}`}>
              <h3 className="event-group-head">
                {key === "live" && <span className="live-dot" aria-hidden="true" />}
                {label}
                <span className="event-group-count">{group.length}</span>
              </h3>
              <ul className="event-list">
                {group.map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      className="event-row"
                      onClick={() => setView({ kind: "dashboard", event })}
                    >
                      <div className="event-row-main">
                        <span className="event-name">{event.name}</span>
                        <span className="event-dates">{formatSchedule(event)}</span>
                      </div>
                      <span className="event-fence">
                        {event.boundary ? `${event.boundary.length}-point geofence` : "no geofence"}
                      </span>
                      <span className="event-row-chevron" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </main>
    </>
  );
}

type Phase = "live" | "upcoming" | "past" | "unscheduled";

/** An event is live between its start and end; events missing either timestamp
 *  can't be placed on the timeline at all, so they get their own bucket. */
function phaseOf(event: FestivalEvent, now: number): Phase {
  if (!event.starts_at || !event.ends_at) return "unscheduled";
  const starts = new Date(event.starts_at).getTime();
  const ends = new Date(event.ends_at).getTime();
  if (now < starts) return "upcoming";
  if (now > ends) return "past";
  return "live";
}

const GROUP_ORDER: { key: Phase; label: string }[] = [
  { key: "live", label: "Live now" },
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "unscheduled", label: "No schedule set" },
];

/** Live/upcoming read forward in time (soonest first); past reads backward
 *  (most recent first), which is the order you'd look for a finished event in. */
function groupEvents(events: FestivalEvent[], now: number) {
  const buckets: Record<Phase, FestivalEvent[]> = {
    live: [],
    upcoming: [],
    past: [],
    unscheduled: [],
  };
  for (const event of events) buckets[phaseOf(event, now)].push(event);

  const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);
  buckets.live.sort((a, b) => time(a.ends_at) - time(b.ends_at));
  buckets.upcoming.sort((a, b) => time(a.starts_at) - time(b.starts_at));
  buckets.past.sort((a, b) => time(b.ends_at) - time(a.ends_at));
  buckets.unscheduled.sort((a, b) => a.name.localeCompare(b.name));

  return GROUP_ORDER.filter(({ key }) => buckets[key].length > 0).map((group) => ({
    ...group,
    events: buckets[group.key],
  }));
}

function formatSchedule(event: FestivalEvent): string {
  if (!event.starts_at || !event.ends_at) return "schedule not set";
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  const starts = new Date(event.starts_at).toLocaleString(undefined, options);
  const ends = new Date(event.ends_at).toLocaleString(undefined, options);
  return `${starts} → ${ends}`;
}
