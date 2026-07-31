"use client"

// On-screen explainer. Someone who has not seen this project should be able to
// open the dashboard, press ABOUT, and understand what is on screen without
// reading the repo.
import { X } from "lucide-react"
import { useEffect } from "react"

const EVENT_LEGEND: [string, string, string][] = [
  ["--evt-http", "http.request", "a request that passed through the nginx gateway"],
  ["--evt-redis", "chat.message", "a chat message published to Redis and delivered to every replica"],
  ["--evt-ws", "presence.*", "a user going online or offline"],
  ["--status-crit", "docker.event", "a container starting, stopping, dying or changing health"],
  ["--evt-sql", "db.stats", "a Postgres sample: queries per second, commits, cache hit rate"],
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
          <h3 className="obs-micro">WHAT THIS IS</h3>
          <p>
            Chorus is a chat application built as a distributed system. An nginx gateway sits in
            front of three services: <em>auth</em>, <em>api</em> and <em>chat</em>. The chat service
            runs as <strong>three replicas</strong>. Postgres stores messages and is the source of
            truth for their order. Redis handles publish/subscribe delivery between replicas and
            tracks which users are online.
          </p>
          <p>
            This page watches that system while it runs. It reads signals the system already
            produces and does not modify any of the services it observes, so it cannot affect the
            behaviour it is measuring.
          </p>
        </section>

        <section>
          <h3 className="obs-micro">HOW THE DATA GETS HERE</h3>
          <pre className="obs-about-diagram">{`docker events ─┐
chan:* pub/sub ─┤
presence keys  ─┼─► Redis Stream ──► observer ──WS──► this page
pg_stat_*      ─┤   (obs:events)     (fold +
nginx log      ─┘                     replay)`}</pre>
          <p>
            A single Redis Stream acts as the message bus, a buffer of the last 2000 events, and a
            replay cursor. When this page connects, the observer first sends a snapshot of the
            current state, then replays recent history, then streams new events as they happen. That
            means a dashboard opened halfway through a demo is complete straight away rather than
            starting empty. If the connection drops, it resumes from the last event it saw.
          </p>
        </section>

        <section>
          <h3 className="obs-micro">READING THE TOPOLOGY</h3>
          <ul className="obs-about-list">
            <li>
              <strong>Bright comets with a trail are individual events.</strong> Each one is a real
              request or message being traced through the system as it happens. A blue comet follows
              a request from the browser through the gateway to whichever service handled it. Three
              pink comets leaving Redis at the same moment are one chat message being delivered to
              all three replicas at once, which is what publish/subscribe does.
            </li>
            <li>
              <strong>A connection that is carrying traffic is drawn brighter</strong> than an idle
              one. Comets are brief, so this is what tells you which paths are in use between them.
            </li>
            <li>
              <strong>You will not see a comet travelling into Redis from a chat replica</strong>,
              only the three coming out. Redis does not tell a subscriber which client published a
              message, and the message itself carries the sender&apos;s user id, not the replica that
              handled it. Drawing an inbound comet would mean picking a replica at random, so nothing
              is drawn instead.
            </li>
            <li>
              One comet is drawn per event, with no sampling. Above roughly 50 events per second the
              view switches to flow mode and comets stop, because tracing individual events is not
              readable at that rate.
            </li>
            <li>
              <strong>The connections to Postgres never animate.</strong> The gateway log only records
              the hop as far as the service, and the Redis tap cannot tell which replica wrote to the
              database. Rather than guess, these are left blank. Click the postgres node to see real
              query statistics instead.
            </li>
            <li>
              <strong>The ring around each node</strong> shows container state: green for running,
              red for stopped, grey for unknown. The glow follows actual CPU usage, and a brief flash
              means an event just passed through that node.
            </li>
            <li>
              <strong>Click any node</strong> for CPU, memory, network and recent activity. Postgres
              and Redis also show live query and publish/subscribe statistics.
            </li>
            <li>
              Above roughly 50 events per second the dots are replaced by moving dashes, so the view
              stays readable during a burst.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="obs-micro">EVENT TYPES</h3>
          <ul className="obs-about-legend">
            {EVENT_LEGEND.map(([token, name, desc]) => (
              <li key={name}>
                <span className="obs-about-swatch" style={{ background: `var(${token})` }} aria-hidden />
                <span className="obs-num obs-about-evt">{name}</span>
                <span>{desc}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="obs-micro">MAKING SOMETHING HAPPEN</h3>
          <ul className="obs-about-list">
            <li>
              <strong>START SIMULATION</strong> replays a recorded event stream, so the dashboard has
              something to show when nobody is using the app. While it is running, an amber{" "}
              <strong>SIMULATION</strong> label is shown and none of the data on screen is live.
              Press it again to reconnect to the real observer.
            </li>
            <li>
              To see real traffic, open <span className="obs-num">/chat</span> in two browser windows
              and send messages between them.
            </li>
            <li>
              To demonstrate fault tolerance, run{" "}
              <span className="obs-num">docker kill chorus-chat-2</span>. The node turns red, the
              other two replicas keep delivering messages, and any client that was connected to it
              reconnects and receives what it missed. Bring it back with{" "}
              <span className="obs-num">docker start chorus-chat-2</span>. Docker does not restart it
              automatically after a manual kill.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="obs-micro">WHAT IS NOT INCLUDED</h3>
          <p>
            There is no distributed tracing. OpenTelemetry is not set up, and the Jaeger container
            runs without receiving any data. The observer is read only: it exposes a health endpoint
            and this WebSocket, and its Docker connection rejects any request that would change
            something. Separate tabs for traces, chat, Redis, database and containers were designed
            but not built, so they are not shown.
          </p>
        </section>
      </aside>
    </div>
  )
}
