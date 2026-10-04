export interface ActivityEvent {
  id: string;
  at: string;
  agent: string;
  kind: string;
  title: string;
  detail?: string;
  image?: string;
  diff?: { op: "+" | "-"; text: string }[];
  added?: number;
  removed?: number;
}

export interface AgentStatus {
  name: string;
  connected: boolean;
  at: string;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** The right-hand AGENT ACTIVITY panel: what the agent read, edited, checked and rendered, newest first. */
export function Activity({ events, agent, footer }: { events: ActivityEvent[]; agent: AgentStatus | null; footer?: React.ReactNode }) {
  const shown = [...events].reverse().slice(0, 100);
  return (
    <section className="panel side activity" aria-label="Agent activity">
      <div className="panel-header">
        <span className="panel-title">Agent activity</span>
        <span className="grow" />
        <span className="muted" style={{ fontSize: 12 }}>
          {agent?.connected ? agent.name : "No agent connected"}
        </span>
      </div>
      <ol className="feed" aria-live="polite">
        {shown.map((e) => (
          <li key={e.id}>
            <div className="feed-title">
              <span className="strong">{e.title}</span>
              {e.added !== undefined && e.removed !== undefined && e.kind === "edit" && (
                <span className="mono muted" style={{ fontSize: 11 }}>
                  +{e.added} −{e.removed}
                </span>
              )}
              <span className="grow" />
              <span className="mono faint" style={{ fontSize: 11 }}>
                {clock(e.at)}
              </span>
            </div>
            {e.detail && <span className="muted">{e.detail}</span>}
            {e.diff && e.diff.length > 0 && (
              <pre className="diff">
                {e.diff.map((d, i) => (
                  <span key={i} className={d.op === "-" ? "del" : "add"}>
                    {d.op === "-" ? "− " : "+ "}
                    {d.text}
                    {"\n"}
                  </span>
                ))}
              </pre>
            )}
            {e.image && (
              <a href={`/api/activity/image/${e.image}`} target="_blank" rel="noreferrer">
                <img className="feed-image" src={`/api/activity/image/${e.image}`} alt={e.title} loading="lazy" />
              </a>
            )}
          </li>
        ))}
        {shown.length === 0 && (
          <li className="muted">
            Nothing yet. When your agent writes compositions, checks frames or renders, it shows up here. Edits to project files show up too.
          </li>
        )}
      </ol>
      {footer}
    </section>
  );
}
