import { useEffect, useRef, useState } from "react";

import {
  createEvent,
  createLandmark,
  deleteLandmark,
  landmarkEmoji,
  listLandmarks,
  updateEvent,
  LANDMARK_KINDS,
  LANDMARK_META,
  type FestivalEvent,
  type LandmarkKind,
  type LatLng,
} from "./api";
import GeofenceMap, {
  MAX_POINTS,
  MIN_POINTS,
  type DrawState,
  type MapLandmark,
} from "./GeofenceMap";

/** A landmark in the editor. Saved ones carry the server `id`; ones added in
 *  this session don't have one until the event exists and they're POSTed. */
interface LocalLandmark extends MapLandmark {
  kind: LandmarkKind;
  id?: string;
  /** Optional geofence for the landmark; null when "no boundary" was chosen. */
  boundary: LatLng[] | null;
}

/** Add-landmark flow: pick a kind → name it (stages only) → click the map to
 *  drop the pin → optionally draw a boundary around it (or skip). */
type Draft =
  | { step: "kind" }
  | { step: "name"; name: string }
  | { step: "place"; kind: LandmarkKind; name: string }
  | { step: "boundary"; key: string };

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
  const [landmarks, setLandmarks] = useState<LocalLandmark[]>([]);
  // Saved landmarks the admin removed; deleted from the server on save.
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Separate draw session for the landmark boundary being drawn (draft.step
  // === "boundary"); kept apart from the event's `draw` so the two don't clash.
  const [landmarkDraw, setLandmarkDraw] = useState<DrawState>({
    points: [],
    closed: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once a create succeeds, so a later failure doesn't strand a duplicate.
  const savedRef = useRef<FestivalEvent | null>(null);

  const { points, closed } = draw;
  const eventId = initial?.id;

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const saved = await listLandmarks(token, eventId);
        if (cancelled) return;
        setLandmarks(
          saved.map((l) => ({
            key: l.id,
            id: l.id,
            kind: l.kind as LandmarkKind,
            name: l.name,
            lat: l.lat,
            lng: l.lng,
            boundary: l.boundary,
          }))
        );
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, getToken]);

  const pickKind = (kind: LandmarkKind) => {
    // Stages are the only individually named landmarks; the rest use their label.
    setDraft(kind === "stage" ? { step: "name", name: "" } : { step: "place", kind, name: "" });
  };

  const placeLandmark = ([lat, lng]: LatLng) => {
    if (draft?.step !== "place") return;
    const key = `new-${Date.now()}-${landmarks.length}`;
    setLandmarks([
      ...landmarks,
      {
        key,
        kind: draft.kind,
        name: draft.name || LANDMARK_META[draft.kind].label,
        lat,
        lng,
        boundary: null,
      },
    ]);
    // Pin dropped — now prompt for its (optional) boundary.
    setLandmarkDraw({ points: [], closed: false });
    setDraft({ step: "boundary", key });
  };

  // The landmark whose boundary is being drawn, if any.
  const boundaryTarget =
    draft?.step === "boundary" ? landmarks.find((l) => l.key === draft.key) ?? null : null;

  // Attach the drawn boundary (or null for "no boundary") and finish the flow.
  const finishBoundary = (boundary: LatLng[] | null) => {
    if (draft?.step !== "boundary") return;
    const key = draft.key;
    setLandmarks((all) => all.map((l) => (l.key === key ? { ...l, boundary } : l)));
    setLandmarkDraw({ points: [], closed: false });
    setDraft(null);
  };

  const undoLandmarkBoundary = () => {
    const { points, closed } = landmarkDraw;
    if (closed) setLandmarkDraw({ points, closed: false });
    else setLandmarkDraw({ points: points.slice(0, -1), closed: false });
  };

  const removeLandmark = (target: LocalLandmark) => {
    setLandmarks(landmarks.filter((l) => l.key !== target.key));
    if (target.id) setRemovedIds([...removedIds, target.id]);
  };

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
      // The event must exist before its landmarks: they carry its id as a
      // foreign key, so they're only written once we have one back. If a
      // landmark write fails afterwards, savedRef makes the retry update that
      // event instead of creating a second one.
      const existing = initial ?? savedRef.current;
      const saved = existing
        ? await updateEvent(token, existing.id, body)
        : await createEvent(token, body);
      savedRef.current = saved;

      try {
        for (const id of [...removedIds]) {
          await deleteLandmark(token, saved.id, id);
          setRemovedIds((ids) => ids.filter((i) => i !== id));
        }
        for (const landmark of landmarks) {
          if (landmark.id) continue;
          const created = await createLandmark(token, saved.id, {
            kind: landmark.kind,
            // generic kinds are labelled server-side
            name: landmark.kind === "stage" ? landmark.name : undefined,
            lat: landmark.lat,
            lng: landmark.lng,
            boundary: landmark.boundary,
          });
          // mark it saved so a retry doesn't add it twice
          setLandmarks((all) =>
            all.map((l) => (l.key === landmark.key ? { ...l, id: created.id } : l))
          );
        }
      } catch (e) {
        throw new Error(
          `Event saved, but a landmark failed: ${e instanceof Error ? e.message : String(e)}. Save again to finish.`
        );
      }
      onCreated(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const drawHint = draft?.step === "place" || draft?.step === "boundary"
    ? "Paused while you edit a landmark"
    : closed
    ? `Geofence closed · ${points.length} points`
    : points.length === 0
      ? "Click the map to drop the first point"
      : points.length < MIN_POINTS
        ? `${points.length} point${points.length === 1 ? "" : "s"} · drop at least ${MIN_POINTS}`
        : "Click the first point (white ring) to close the shape";

  // While drawing a landmark boundary the map edits `landmarkDraw`; otherwise
  // it edits the event's `draw`. The inactive boundaries render as muted
  // context so shapes can be lined up against one another.
  const drawingLandmark = draft?.step === "boundary";
  const landmarkShapes = landmarks
    .filter((l) => l.key !== boundaryTarget?.key)
    .map((l) => l.boundary)
    .filter((b): b is LatLng[] => b != null);
  const staticShapes =
    drawingLandmark && closed ? [points, ...landmarkShapes] : landmarkShapes;

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

        <div className="fence-status">
          <div className="fence-status-row">
            <span>Landmarks</span>
            <span className="mono-count">{landmarks.length}</span>
          </div>

          {landmarks.length > 0 && (
            <ul className="landmark-list">
              {landmarks.map((landmark) => (
                <li key={landmark.key}>
                  <span className="landmark-emoji">{landmarkEmoji(landmark.kind)}</span>
                  <span className="landmark-name">{landmark.name}</span>
                  {landmark.boundary && (
                    <span className="landmark-fence" title="Has a boundary">
                      ⬡
                    </span>
                  )}
                  <button
                    type="button"
                    className="landmark-remove"
                    onClick={() => removeLandmark(landmark)}
                    aria-label={`Remove ${landmark.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {draft === null && (
            <button type="button" className="ghost" onClick={() => setDraft({ step: "kind" })}>
              Add landmark
            </button>
          )}

          {draft?.step === "kind" && (
            <>
              <p className="fence-hint">What kind of landmark?</p>
              <div className="kind-grid">
                {LANDMARK_KINDS.map((kind) => (
                  <button
                    type="button"
                    key={kind}
                    className="kind-btn"
                    onClick={() => pickKind(kind)}
                  >
                    <span className="kind-emoji">{LANDMARK_META[kind].emoji}</span>
                    {LANDMARK_META[kind].label}
                  </button>
                ))}
              </div>
              <button type="button" className="ghost" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </>
          )}

          {draft?.step === "name" && (
            <>
              <label className="field">
                <span>Stage name</span>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft({ step: "name", name: e.target.value })}
                  placeholder="Main Stage"
                  maxLength={60}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && draft.name.trim()) {
                      e.preventDefault();
                      setDraft({ step: "place", kind: "stage", name: draft.name.trim() });
                    }
                  }}
                />
              </label>
              <div className="fence-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={!draft.name.trim()}
                  onClick={() =>
                    setDraft({ step: "place", kind: "stage", name: draft.name.trim() })
                  }
                >
                  Place on map
                </button>
                <button type="button" className="ghost" onClick={() => setDraft(null)}>
                  Cancel
                </button>
              </div>
            </>
          )}

          {draft?.step === "place" && (
            <>
              <p className="fence-hint placing-hint">
                {LANDMARK_META[draft.kind].emoji} Click the map to place{" "}
                {draft.kind === "stage" ? draft.name : LANDMARK_META[draft.kind].label}
              </p>
              <button type="button" className="ghost" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </>
          )}

          {draft?.step === "boundary" && boundaryTarget && (
            <>
              <div className="fence-status-row">
                <span>{boundaryTarget.name} boundary</span>
                <span className="mono-count">
                  {landmarkDraw.points.length} / {MAX_POINTS}
                </span>
              </div>
              <p className="fence-hint">
                {landmarkDraw.closed
                  ? `Boundary closed · ${landmarkDraw.points.length} points`
                  : landmarkDraw.points.length === 0
                    ? "Draw a boundary around this landmark, or skip it"
                    : landmarkDraw.points.length < MIN_POINTS
                      ? `${landmarkDraw.points.length} point${landmarkDraw.points.length === 1 ? "" : "s"} · drop at least ${MIN_POINTS}`
                      : "Click the first point (white ring) to close the shape"}
              </p>
              <div className="fence-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={undoLandmarkBoundary}
                  disabled={landmarkDraw.points.length === 0}
                >
                  {landmarkDraw.closed ? "Reopen" : "Undo point"}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setLandmarkDraw({ points: [], closed: false })}
                  disabled={landmarkDraw.points.length === 0}
                >
                  Clear
                </button>
              </div>
              <div className="fence-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={!landmarkDraw.closed}
                  onClick={() => finishBoundary(landmarkDraw.points)}
                >
                  Save boundary
                </button>
                <button type="button" className="ghost" onClick={() => finishBoundary(null)}>
                  No boundary
                </button>
              </div>
            </>
          )}
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

      <GeofenceMap
        state={drawingLandmark ? landmarkDraw : draw}
        onChange={drawingLandmark ? setLandmarkDraw : setDraw}
        fitTo={initial?.boundary ?? undefined}
        landmarks={landmarks}
        placing={draft?.step === "place"}
        onPlaceLandmark={placeLandmark}
        staticShapes={staticShapes}
      />
    </div>
  );
}
