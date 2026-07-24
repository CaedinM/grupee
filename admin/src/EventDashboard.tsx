import { type FestivalEvent } from "./api";

/** When either timestamp is missing the event isn't fully scheduled yet. */
function formatTime(iso: string | null | undefined): string {
  if (!iso) return "Not set";
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Read-only overview of a single event. Deliberately minimal for now —
 *  name, schedule, and a jump to the editor; richer panels come later. */
export default function EventDashboard({
  event,
  onEdit,
  onManageSets,
  onBack,
}: {
  event: FestivalEvent;
  onEdit: () => void;
  onManageSets: () => void;
  onBack: () => void;
}) {
  return (
    <main className="dashboard">
      <button type="button" className="ghost dashboard-back" onClick={onBack}>
        ← All events
      </button>

      <header className="dashboard-header">
        <p className="status-tag">EVENT</p>
        <h2>{event.name}</h2>
      </header>

      <section className="dashboard-panel">
        <div className="dashboard-field">
          <span className="dashboard-label">Starts</span>
          <span className="dashboard-value">{formatTime(event.starts_at)}</span>
        </div>
        <div className="dashboard-field">
          <span className="dashboard-label">Ends</span>
          <span className="dashboard-value">{formatTime(event.ends_at)}</span>
        </div>
      </section>

      <div className="dashboard-actions">
        <button type="button" className="primary" onClick={onManageSets}>
          Manage sets
        </button>
        <button type="button" className="ghost" onClick={onEdit}>
          Edit event
        </button>
      </div>
    </main>
  );
}
