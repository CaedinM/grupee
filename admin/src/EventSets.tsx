import { useEffect, useMemo, useState } from "react";

import {
  createSet,
  deleteSet,
  listLandmarks,
  listSets,
  updateSet,
  type FestivalEvent,
  type FestivalSet,
  type Landmark,
} from "./api";

/** Vertical scale of the calendar: pixels per minute (60px = one hour). */
const PX_PER_MIN = 1;
/** Snap grid clicks to this many minutes when seeding a new set's start. */
const SNAP_MIN = 15;
/** Left time-gutter width; kept in sync with .cal-gutter in index.css. */
const GUTTER_PX = 68;

/** ISO UTC → the "YYYY-MM-DDTHH:mm" a datetime-local input expects (local zone). */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A single stage (or the catch-all) rendered as one calendar column. */
interface Column {
  id: string | null; // landmark id, or null for the "Unassigned" column
  name: string;
}

/** The add/edit form's working copy. `id` present ⇒ editing an existing set. */
interface SetForm {
  id?: string;
  artist: string;
  landmarkId: string; // "" ⇒ no stage
  start: string; // datetime-local value
  end: string;
}

export default function EventSets({
  event,
  getToken,
  onBack,
}: {
  event: FestivalEvent;
  getToken: () => Promise<string | null>;
  onBack: () => void;
}) {
  const [landmarks, setLandmarks] = useState<Landmark[] | null>(null);
  const [sets, setSets] = useState<FestivalSet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<SetForm | null>(null);
  const [busy, setBusy] = useState(false);

  const startMs = event.starts_at ? new Date(event.starts_at).getTime() : null;
  const endMs = event.ends_at ? new Date(event.ends_at).getTime() : null;

  const refresh = async () => {
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Session expired — sign in again");
      const [lm, st] = await Promise.all([
        listLandmarks(token, event.id),
        listSets(token, event.id),
      ]);
      setLandmarks(lm);
      setSets(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    refresh();
    // refresh closes over stable values (event.id, getToken)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id]);

  const stages = useMemo(
    () => (landmarks ?? []).filter((l) => l.kind === "stage"),
    [landmarks]
  );

  // Columns are the stages, plus an "Unassigned" column iff some set has no stage.
  const columns = useMemo<Column[]>(() => {
    const cols: Column[] = stages.map((s) => ({ id: s.id, name: s.name }));
    if ((sets ?? []).some((s) => s.landmark_id === null)) {
      cols.push({ id: null, name: "Unassigned" });
    }
    return cols;
  }, [stages, sets]);

  // Hourly gridlines, aligned to the clock (not to the event's start minute).
  const ticks = useMemo(() => {
    if (startMs === null || endMs === null) return [];
    const out: number[] = [];
    const first = new Date(startMs);
    first.setMinutes(0, 0, 0);
    let t = first.getTime();
    if (t < startMs) t += 3_600_000;
    for (; t <= endMs; t += 3_600_000) out.push(t);
    return out;
  }, [startMs, endMs]);

  if (startMs === null || endMs === null) {
    return (
      <main className="sets">
        <button type="button" className="ghost dashboard-back" onClick={onBack}>
          ← {event.name}
        </button>
        <p className="home-empty">
          Set the event's start and end times in the editor before scheduling sets.
        </p>
      </main>
    );
  }

  const gridHeight = ((endMs - startMs) / 60_000) * PX_PER_MIN;
  const topFor = (ms: number) => ((ms - startMs) / 60_000) * PX_PER_MIN;

  const openNew = (landmarkId: string | null, startAtMs: number) => {
    const start = Math.min(Math.max(startAtMs, startMs), endMs - 30 * 60_000);
    const end = Math.min(start + 60 * 60_000, endMs);
    setForm({
      artist: "",
      landmarkId: landmarkId ?? "",
      start: toLocalInput(new Date(start).toISOString()),
      end: toLocalInput(new Date(end).toISOString()),
    });
  };

  const openEdit = (set: FestivalSet) => {
    setForm({
      id: set.id,
      artist: set.artist,
      landmarkId: set.landmark_id ?? "",
      start: toLocalInput(set.start_time),
      end: toLocalInput(set.end_time),
    });
  };

  // Click on empty column space seeds a new set at that stage + time.
  const onColumnClick = (colId: string | null, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const minsFromTop = (e.clientY - rect.top) / PX_PER_MIN;
    const snapped = Math.round(minsFromTop / SNAP_MIN) * SNAP_MIN;
    openNew(colId, startMs + snapped * 60_000);
  };

  const formValid =
    form !== null &&
    form.artist.trim() !== "" &&
    form.start !== "" &&
    form.end !== "" &&
    new Date(form.end) > new Date(form.start);

  const save = async () => {
    if (!form || !formValid) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Session expired — sign in again");
      const body = {
        artist: form.artist.trim(),
        start_time: new Date(form.start).toISOString(),
        end_time: new Date(form.end).toISOString(),
        landmark_id: form.landmarkId || null,
      };
      if (form.id) await updateSet(token, event.id, form.id, body);
      else await createSet(token, event.id, body);
      setForm(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!form?.id) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Session expired — sign in again");
      await deleteSet(token, event.id, form.id);
      setForm(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="sets">
      <div className="sets-topline">
        <button type="button" className="ghost dashboard-back" onClick={onBack}>
          ← {event.name}
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => openNew(columns[0]?.id ?? null, startMs)}
        >
          Add set
        </button>
      </div>

      <header className="dashboard-header">
        <p className="status-tag">SCHEDULE</p>
        <h2>Sets</h2>
      </header>

      {error && <p className="field-error">{error}</p>}

      {sets === null || landmarks === null ? (
        <p className="home-empty">Loading…</p>
      ) : columns.length === 0 ? (
        <p className="home-empty">
          No stages yet — add a stage landmark in the event editor, then come back to schedule
          sets on it.
        </p>
      ) : (
        <div className="cal-scroll">
          <div className="cal" style={{ ["--gutter" as string]: `${GUTTER_PX}px` }}>
            <div className="cal-head">
              <div className="cal-gutter-head" />
              {columns.map((col) => (
                <div key={col.id ?? "unassigned"} className="cal-col-head">
                  {col.name}
                </div>
              ))}
            </div>

            <div className="cal-body" style={{ height: gridHeight }}>
              <div className="cal-gutter">
                {ticks.map((t) => (
                  <span key={t} className="cal-tick-label" style={{ top: topFor(t) }}>
                    {new Date(t).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                ))}
              </div>

              <div className="cal-grid">
                <div className="cal-lines">
                  {ticks.map((t) => (
                    <div key={t} className="cal-line" style={{ top: topFor(t) }} />
                  ))}
                </div>
                <div className="cal-cols">
                  {columns.map((col) => (
                    <div
                      key={col.id ?? "unassigned"}
                      className="cal-col"
                      onClick={(e) => onColumnClick(col.id, e)}
                    >
                      {sets
                        .filter((s) => s.landmark_id === col.id)
                        .map((s) => {
                          const top = topFor(new Date(s.start_time).getTime());
                          const height = Math.max(
                            ((new Date(s.end_time).getTime() -
                              new Date(s.start_time).getTime()) /
                              60_000) *
                              PX_PER_MIN,
                            18
                          );
                          return (
                            <button
                              key={s.id}
                              type="button"
                              className="cal-set"
                              style={{ top, height }}
                              onClick={(e) => {
                                e.stopPropagation();
                                openEdit(s);
                              }}
                            >
                              <span className="cal-set-artist">{s.artist}</span>
                              <span className="cal-set-time">
                                {new Date(s.start_time).toLocaleTimeString(undefined, {
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {form && (
        <div className="modal-overlay" onClick={() => !busy && setForm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{form.id ? "Edit set" : "New set"}</h3>

            <label className="field">
              <span>Artist</span>
              <input
                type="text"
                value={form.artist}
                onChange={(e) => setForm({ ...form, artist: e.target.value })}
                placeholder="Skrillex"
                maxLength={120}
                autoFocus
              />
            </label>

            <label className="field">
              <span>Stage</span>
              <select
                value={form.landmarkId}
                onChange={(e) => setForm({ ...form, landmarkId: e.target.value })}
              >
                <option value="">No stage</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Starts</span>
              <input
                type="datetime-local"
                value={form.start}
                onChange={(e) => setForm({ ...form, start: e.target.value })}
              />
            </label>

            <label className="field">
              <span>Ends</span>
              <input
                type="datetime-local"
                value={form.end}
                onChange={(e) => setForm({ ...form, end: e.target.value })}
              />
            </label>

            {form.start && form.end && new Date(form.end) <= new Date(form.start) && (
              <p className="field-error">End must be after start.</p>
            )}

            <div className="modal-actions">
              <button type="button" className="primary" onClick={save} disabled={!formValid || busy}>
                {busy ? "Saving…" : form.id ? "Save changes" : "Add set"}
              </button>
              <button type="button" className="ghost" onClick={() => setForm(null)} disabled={busy}>
                Cancel
              </button>
              {form.id && (
                <button
                  type="button"
                  className="ghost danger"
                  onClick={remove}
                  disabled={busy}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
