import { useState } from "react";
import { Icon } from "./icons";

export interface SetupStatus {
  chrome: { ready: boolean; downloading: number | null; problem?: string };
  ffmpeg: { ready: boolean; encoder: string | null; problem?: string };
  files: { compositions: number; assets: number; refs: boolean; agents: boolean; mcp: boolean };
  agent: { name: string; connected: boolean } | null;
  firstRun: boolean;
  mcpCommand: string | null;
  examplePrompt: string;
}

const ENCODER: Record<string, string> = { h264_videotoolbox: "VideoToolbox", libx264: "x264", libopenh264: "OpenH264" };

function Item({ state, label, value, progress }: { state: "done" | "busy" | "todo" | "bad"; label: string; value: React.ReactNode; progress?: number }) {
  return (
    <li className={`check${progress !== undefined ? " tall" : ""}`}>
      <div className="check-row">
        {state === "done" ? (
          <Icon.check />
        ) : state === "busy" ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--ink-muted)" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" className="spin">
            <path d="M8 2.5a5.5 5.5 0 105.5 5.5" />
          </svg>
        ) : (
          <span className={`todo${state === "bad" ? " bad" : ""}`} aria-hidden="true" />
        )}
        <span className="grow">{label}</span>
        <span className="muted">{value}</span>
      </div>
      {progress !== undefined && (
        <div className="bar thin" role="progressbar" aria-label={label} aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${progress * 100}%` }} />
        </div>
      )}
    </li>
  );
}

function Copyable({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copyable">
      <pre>{text}</pre>
      <button
        type="button"
        className="btn"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

type Agent = "claude" | "codex" | "cursor" | "other";

/** The first-run page: what's ready, and how to connect an agent. Turns into the studio when one connects. */
export function Connect({ name, root, port, setup, onOpenStudio }: { name: string; root: string; port: number; setup: SetupStatus; onOpenStudio(): void }) {
  const [tab, setTab] = useState<Agent>("claude");
  const mcp = setup.mcpCommand ?? "edit mcp";
  const { files } = setup;

  const steps: Record<Agent, React.ReactNode[]> = {
    claude: [
      <>
        <span>In a new terminal, open the project and start Claude Code.</span>
        <Copyable text={`cd ${root}\nclaude`} />
      </>,
      <span>
        Allow the <span className="mono">edit</span> tools when Claude Code asks. It finds them in the project's <span className="mono">.mcp.json</span>.
      </span>,
    ],
    codex: [
      <>
        <span>Add the tools to Codex once, then start it in the project.</span>
        <Copyable text={`codex mcp add edit -- ${mcp}\ncd ${root}\ncodex`} />
      </>,
      <span>
        Codex reads the project's <span className="mono">AGENTS.md</span> for the API and the workflow.
      </span>,
    ],
    cursor: [
      <>
        <span>Open the project folder in Cursor.</span>
        <Copyable text={`cursor ${root}`} />
      </>,
      <span>
        Turn on the <span className="mono">edit</span> server in Cursor's MCP settings. It's listed from <span className="mono">.cursor/mcp.json</span>.
      </span>,
    ],
    other: [
      <span>
        Any agent that edits files works: point it at <span className="mono">AGENTS.md</span>, and the studio shows its changes live.
      </span>,
      <>
        <span>For the tools (rendering frames, beats, errors, your selection), run this as a stdio MCP server:</span>
        <Copyable text={mcp} />
      </>,
    ],
  };

  return (
    <div className="connect">
      <header className="menubar">
        <span className="logo">edit</span>
        <span className="grow" />
        <span className="mono muted" style={{ fontSize: 12 }}>
          {root}
        </span>
      </header>
      <main className="connect-main">
        <div className="connect-col">
          <div className="connect-intro">
            <span className="eyebrow">First run</span>
            <h1>{name} is almost ready</h1>
            <p className="muted">Everything runs on this computer. Once your agent connects, this page turns into the studio.</p>
          </div>

          <section className="panel" aria-labelledby="h-setup">
            <h2 id="h-setup" className="panel-header panel-title" style={{ margin: 0 }}>
              Setup
            </h2>
            <ul className="checks">
              <Item state="done" label="Helper running" value={<span className="mono">localhost:{port}</span>} />
              <Item
                state={setup.chrome.ready ? "done" : setup.chrome.problem ? "bad" : "busy"}
                label="Headless Chromium"
                value={setup.chrome.ready ? "Ready" : setup.chrome.problem ? "Download failed; it retries on the first render" : "Downloading, one time only"}
                progress={setup.chrome.downloading ?? undefined}
              />
              <Item
                state={setup.ffmpeg.ready ? "done" : "bad"}
                label="ffmpeg"
                value={setup.ffmpeg.ready ? `Ready · ${ENCODER[setup.ffmpeg.encoder ?? ""] ?? setup.ffmpeg.encoder}` : <span className="mono">brew install ffmpeg</span>}
              />
              <Item
                state={files.agents && files.mcp ? "done" : "todo"}
                label="Project files"
                value={
                  <span className="mono" style={{ fontSize: 12 }}>
                    {files.agents && files.mcp ? "_assets/ · _refs/ · compositions/ · AGENTS.md" : "Run edit init . to add AGENTS.md and .mcp.json"}
                  </span>
                }
              />
              <Item
                state={setup.agent?.connected ? "done" : "todo"}
                label="Agent connected"
                value={setup.agent?.connected ? setup.agent.name : "Waiting for your agent"}
              />
            </ul>
          </section>

          <section className="connect-steps" aria-labelledby="h-connect">
            <h2 id="h-connect" className="display">
              Connect your agent
            </h2>
            <div role="tablist" aria-label="Agent" className="agent-tabs">
              {(
                [
                  ["claude", "Claude Code"],
                  ["codex", "Codex"],
                  ["cursor", "Cursor"],
                  ["other", "Other"],
                ] as const
              ).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} className="tab" aria-current={tab === key ? "page" : undefined} onClick={() => setTab(key)}>
                  {label}
                </button>
              ))}
            </div>
            <ol className="steps">
              {[...steps[tab], <>
                <span>Ask for your first video.</span>
                <span className="quote">“{setup.examplePrompt}”</span>
              </>].map((step, i) => (
                <li key={`${tab}-${i}`}>
                  <span className="step-n">{i + 1}</span>
                  <div className="step-body">{step}</div>
                </li>
              ))}
            </ol>
          </section>

          <div className="connect-foot">
            <span className="muted">No agent yet? You can still preview and render.</span>
            <span className="grow" />
            <button type="button" className="btn" onClick={onOpenStudio}>
              Open the studio
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
