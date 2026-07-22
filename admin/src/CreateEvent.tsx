import { useState } from "react";

import { createEvent, updateEvent, type FestivalEvent } from "./api";
import GeofenceMap, { MAX_POINTS, MIN_POINTS, type DrawState } from "./GeofenceMap";

/** ISO UTC timestamp → the local-time "YYYY-MM-DDTHH:mm" a datetime-local
 *  input expects (the inverse of the toISOString conversion on submit). */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Create form when `initial` is absent; edit form (prefilled, saving via
 *  PUT /events/{id}) when it's present. */
export default function CreateEvent({
  getToken,
  initial,
  onCreated,
  onCancel,
}: {
  getToken: () => Promise<string | null>;
  initial?: FestivalEvent;
  onCreated: (event: FestivalEvent) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [startsAt, setStartsAt] = useState(toLocalInput(initial?.starts_at));
  const [endsAt, setEndsAt] = useState(toLocalInput(initial?.ends_at));
  const [draw, setDraw] = useState<DrawState>(() =>
    initial?.boundary?.length
      ? { points: initial.boundary, closed: true }
      : { points: [], closed: false }
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { points, closed } = draw;

  const undo = () => {
    setError(null);
    // Undo on a closed shape reopens it first; the vertices stay.
    if (closed) setDraw({ points, closed: false });
    else setDraw({ points: points.slice(0, -1), closed: false });
  };

  const clear = () => {
    setError(null);
    setDraw({ points: [], closed: false });
  };

  const scheduleValid =
    startsAt !== "" && endsAt !== "" && new Date(endsAt) > new Date(startsAt);
  const boundaryValid = points.length === 0 || closed;
  const canSubmit = name.trim() !== "" && scheduleValid && boundaryValid && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Session expired — sign in again");
      const body = {
        name: name.trim(),
        // datetime-local values are timezone-less; Date() reads them in this
        // machine's zone and toISOString() ships the true instant as UTC.
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        boundary: closed ? points : null,
      };
      onCreated(
        initial ? await updateEvent(token, initial.id, body) : await createEvent(token, body)
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const drawHint = closed
    ? `Geofence closed · ${points.length} points`
    : points.length === 0
      ? "Click the map to drop the first point"
      : points.length < MIN_POINTS
        ? `${points.length} point${points.length === 1 ? "" : "s"} · drop at least ${MIN_POINTS}`
        : "Click the first point (white ring) to close the shape";

  return (
    <div className="create-event">
      <aside className="create-panel">
        <div className="create-panel-header">
          <p className="status-tag">{initial ? "EDIT EVENT" : "NEW EVENT"}</p>
          <h2>{initial ? "Edit Event" : "Create New Event"}</h2>
        </div>

        <label className="field">
          <span>Title</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Hard Summer 2026"
            maxLength={80}
            autoFocus
          />
        </label>

        <label className="field">
          <span>Starts</span>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </label>

        <label className="field">
          <span>Ends</span>
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </label>
        {startsAt && endsAt && !scheduleValid && (
          <p className="field-error">End must be after start.</p>
        )}

        <div className="fence-status">
          <div className="fence-status-row">
            <span>Geofence</span>
            <span className="mono-count">
              {points.length} / {MAX_POINTS}
            </span>
          </div>
          <p className="fence-hint">{drawHint}</p>
          <div className="fence-actions">
            <button type="button" className="ghost" onClick={undo} disabled={points.length === 0}>
              {closed ? "Reopen" : "Undo point"}
            </button>
            <button type="button" className="ghost" onClick={clear} disabled={points.length === 0}>
              Clear
            </button>
          </div>
        </div>

        {error && <p className="field-error">{error}</p>}

        <div className="create-actions">
          <button type="button" className="primary" onClick={submit} disabled={!canSubmit}>
            {busy ? "Saving…" : initial ? "Save changes" : "Create event"}
          </button>
          <button type="button" className="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </aside>

      <GeofenceMap state={draw} onChange={setDraw} fitTo={initial?.boundary ?? undefined} />
    </div>
  );
}
