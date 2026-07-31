"use client"

// On-screen explainer. Someone who has never seen this project should be able
// to open the dashboard, press ABOUT, and understand what they are looking at
// without reading the repo, including what the page cannot show and why.
import { X } from "lucide-react"
import { useEffect } from "react"

const COMET_LEGEND: [string, string, string][] = [
  ["--accent-strong", "blue", "a REST request: login, channel list, history, join"],
  ["--evt-ws", "green", "a chat message arriving at a replica and being published to Redis"],
  ["--evt-redis", "pink", "Redis delivering that message out to all three replicas"],
]

export function AboutPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div className="obs-about-scrim" role="presentation" onClick={onClose}>
      <aside
        className="obs-about"
        role="dialog"
        aria-modal="true"
        aria-label="about this dashboard"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="obs-about-head">
          <span className="obs-about-title">CHORUS MISSION CONTROL</span>
          <button type="button" className="obs-drawer-close" onClick={onClose} aria-label="close">
            <X size={14} />
          </button>
        </div>

        <section>
          <h3 className="obs-micro">THE SYSTEM</h3>
          <p>
            Chorus is a chat application split into separate services behind an nginx gateway:{" "}
            <em>auth</em> issues tokens, <em>api</em> serves channels and history, and{" "}
            <em>chat</em> holds the WebSocket connections. The chat service runs as{" "}
            <strong>three replicas</strong>, and the gateway pins each user to one of them.
          </p>
          <p>
            That is why Redis matters. Two users in the same channel may be connected to different
            replicas, so a message cannot simply be sent back down the sockets of the replica that
            received it. The receiving replica writes the message to Postgres, which assigns its id
            and therefore its order, then publishes it to Redis. Every replica is subscribed, so each
            one delivers the message to its own connected users. Redis also holds presence keys with
            a short expiry, which is how the system knows who is online.
          </p>
        </section>

        <section>
          <h3 className="obs-micro">HOW THIS PAGE SEES IT</h3>
          <pre className="obs-about-diagram">{`docker events   ─┐
chan:* pub/sub   ─┤
presence keys    ─┼─► Redis stream ──► observer ──WS──► this page
pg_stat_*        ─┤   (obs:events)
nginx access log ─┤
chat ws events   ─┘`}</pre>
          <p>
            Five of those six sources are read from outside: the observer watches Docker, Redis and
            Postgres directly and tails the gateway log, without the services knowing. The sixth is
            different. A WebSocket frame is invisible from the outside, because the connection is
            already open and Redis never reveals which client published a message, so the chat
            service reports those two facts itself. That reporting is fire and forget: if it fails,
            the dashboard goes quiet and the chat keeps working.
          </p>
          <p>
            Everything lands in one Redis stream that serves as the message bus, a buffer of the last
            2000 events and a replay cursor. On connect you get a snapshot of current state, then
            recent history, then live events. A page opened halfway through a demo is complete
            immediately, and a dropped connection resumes from the last event it saw.
          </p>
        </section>

        <section>
          <h3 className="obs-micro">READING THE DASHBOARD</h3>
          <p>
            Each comet is one real event, drawn as it happens. There is no sampling and no animation
            running on a timer.
          </p>
          <ul className="obs-about-legend">
            {COMET_LEGEND.map(([token, name, desc]) => (
              <li key={name}>
                <span className="obs-about-swatch" style={{ background: `var(${token})` }} aria-hidden />
                <span className="obs-num obs-about-evt">{name}</span>
                <span>{desc}</span>
              </li>
            ))}
          </ul>
          <ul className="obs-about-list">
            <li>
              One message produces a green comet in and three pink comets out. That is the whole
              point of publish and subscribe, drawn as it happens.
            </li>
            <li>
              A connection carrying traffic is drawn brighter than an idle one. The ring around each
              node shows container state, green for running and red for stopped, and its glow follows
              real CPU usage.
            </li>
            <li>
              <strong>Click any node</strong> for CPU, memory, network and recent activity. Postgres
              and Redis show live query and publish/subscribe statistics instead.
            </li>
            <li>
              <strong>START SIMULATION</strong> replays a recorded feed so the page has something to
              show when nobody is using the app. An amber SIMULATION label is shown throughout, and
              none of that data is live.
            </li>
            <li>
              To see the failure demo, run <span className="obs-num">docker kill chorus-chat-2</span>.
              The node turns red, the other replicas keep delivering, and clients reconnect and
              receive what they missed. Restart it with{" "}
              <span className="obs-num">docker start chorus-chat-2</span>, which Docker will not do on
              its own after a manual kill.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="obs-micro">LIMITATIONS</h3>
          <ul className="obs-about-list">
            <li>
              <strong>The connections to Postgres never animate.</strong> The gateway log stops at the
              service it routed to, and nothing reports individual database calls, so there is no
              honest way to attribute one. They stay blank rather than guess.
            </li>
            <li>
              <strong>Delivery back to the browser is not drawn.</strong> That last step is another
              WebSocket frame, so it is invisible for the same reason the send was, and only the send
              side is reported.
            </li>
            <li>
              <strong>Above roughly 50 events per second the comets stop</strong> and the connections
              switch to moving dashes. Individual events are not readable at that rate.
            </li>
            <li>
              <strong>There is no distributed tracing.</strong> OpenTelemetry is not set up and the
              Jaeger container receives nothing, so there are no spans and no waterfall view.
            </li>
            <li>
              <strong>The dashboard cannot control anything.</strong> The observer exposes a health
              endpoint and this WebSocket, and its Docker connection refuses every request that would
              change something. Killing a container is done from a terminal.
            </li>
            <li>
              <strong>Only this Overview screen exists.</strong> Separate tabs for traces, chat,
              Redis, database and containers were designed but not built.
            </li>
          </ul>
        </section>
      </aside>
    </div>
  )
}
