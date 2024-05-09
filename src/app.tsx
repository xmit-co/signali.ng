import { Signal, signal } from "@preact/signals";

interface Client {}

const clients: Signal<Client[]> = signal([]);

function TestBedClient({ client }: { client: Client }) {
  return (
    <div>
      <code>{JSON.stringify(client)}</code>
    </div>
  );
}

function TestBed() {
  const clientViews = clients.value.map((c) => <TestBedClient client={c} />);
  return (
    <>
      {clientViews}
      <button onClick={() => (clients.value = [{}, ...clients.value])}>
        Add client
      </button>
    </>
  );
}

export function App() {
  return (
    <>
      <header>
        <div class="logo">🔁</div>
        <h1>signali.ng: fast lane to WebRTC</h1>
        <h2>
          Avoid building yet another signaling service,
          <br />
          rely on highly available infrastructure instead.
        </h2>
        <h2 style={{ color: "red" }}>Work in Progress</h2>
      </header>
      <main>
        <details>
          <summary>Goals &amp; non-goals</summary>
          <ul>
            <li>
              <b>Not</b> a general-purpose communication system.
            </li>
            <li>
              Enable peer discovery and WebRTC connection establishment through
              lightweight announcements in lobbies/rooms and 1:1.
            </li>
            <li>
              Offer as much privacy as possible, but{" "}
              <b>leave end-to-end encryption to be an app-level concern</b> (we
              offer TLS).
            </li>
            <li>
              We perform anonymized analytics to improve the service, but your
              data is not used or shared in any other way for any other purpose,
              unless legally required to do so.
            </li>
          </ul>
        </details>
        <details>
          <summary>Protocol</summary>
          <h2>High-level design</h2>
          <p>
            The protocol is based on WebSocket, where all frames are binary
            &amp; encoded with CBOR.
          </p>
          <p>
            Every connection starts empty, then gets exactly one session
            attached to it. Each session has a dedicated inbox for 1:1 messaging
            and subscriptions to topics.
          </p>
          <p>
            Subscriptions are optional: it is possible to retrieve recent
            messages from a topic without subscribing to it.
          </p>
          <p>
            Sessions are designed to survive disconnections, but they're not
            fully persistent, and can disappear after a few hours of inactivity.
            When connecting, a session must first be opened (passing a{" "}
            <code>null</code> <code>recoveryKey</code>) or recovered (passing a
            previously received <code>recoveryKey</code>), which is not
            guaranteed to succeed.
          </p>
          <p>
            Each session has an associated <code>sessionID</code>, determined by
            the server upon session initialization, which uniquely identifies
            them as message senders and recipients.
          </p>
          <p>
            At most one message is ever retained by sender and recipient (topic
            or inbox), but they're guaranteed to be retained until:
            <ul>
              <li>
                another message from the same sender and to the same recipient
                replaces them,
              </li>
              <li>they expire, which they all do,</li>
              <li>
                for inbox messages, the recipient session acknowledges them or
                expires.
              </li>
            </ul>
          </p>
          <p>
            Sessions recovered after a disconnection continue where they left
            off: previously sent messages need not be resent, clients can expect
            to receive any unacknowledged messages from their inbox, and topic
            subscriptions to <em>restart</em> (rather than resume: once again, a
            backlog of at most one fresh message per sender is transmitted
            according to the subscription settings, before new messages are
            transmitted live).
          </p>
          <h2>Limits (subject to change)</h2>
          <ul>
            <li>
              Sessions are preserved for at most 1 hour without connections.
            </li>
            <li>
              Messages have a maximum size of 1 KiB and a maximum expiration
              time of 5 minutes.
            </li>
            <li>
              Session IDs are guaranteed to be at most 16 bytes. Topics must be
              at most 1 KiB.
            </li>
          </ul>
          <h2>Server errors</h2>
          <p>
            Server frames of the form{" "}
            <code>{"{ 0: [ { 0: string, … }, … ] }"}</code> are lists of errors.
          </p>
          <h2>(Re-)connection</h2>
          <p>
            Clients connect to <code>wss://signali.ng</code> and send an
            initialization frame.
          </p>
          <p>
            For a new session, they send <code>{"{ 0: null }"}</code>.
          </p>
          <p>
            For an existing session, they send{" "}
            <code>{"{ 0: recoveryKey(UInt8Array) }"}</code>.
          </p>
          <p>
            In return, they receive a frame of the form:
            <br />
            <code>
              {
                "{ 0: errors[],\n  1: sessionID(UInt8Array),\n  2: recoveryKey(UInt8Array),\n  3: messages(Message[]),\n  10: maxExpiration(uint, s),\n  11: maxMessageSize(uint) }"
              }
            </code>
            , where <code>0</code>, <code>3</code>, <code>10</code>, and{" "}
            <code>11</code> are optional.
          </p>
          <p>
            The <code>sessionID</code> might have changed despite the
            transmission of a <code>recoveryKey</code>, if their session was
            lost (<em>eg</em> expired). There should also be an error in that
            case.
          </p>
          <p>
            The <code>recoveryKey</code> should be kept for session recovery in
            case of disconnection. Note that it can change on each connection
            and that the latest discovered value should be used.
          </p>
          <h2>Receiving messages</h2>
          <p>
            Messages can belong to a topic or a session's inbox. Server frames
            containing messages expose them under the key <code>3</code>, as an
            array of maps, as seen above.
          </p>
          <ul>
            <li>
              Topic messages take the form:
              <br />
              <code>
                {
                  "{ 0: payload(UInt8Array),\n  1: sessionID(UInt8Array),\n  2: topic(UInt8Array),\n  4: sentAt(uint, Epoch s)\n  5: expiresAt(uint, Epoch s) }"
                }
              </code>
              .
            </li>
            <li>
              Inbox messages take the form:
              <br />
              <code>
                {
                  "{ 0: payload(UInt8Array),\n  1: sessionID(UInt8Array),\n  3: index(uint),\n  4: sentAt(uint, Epoch s)\n  5: expiresAt(uint, Epoch s) }"
                }
              </code>
              .
            </li>
          </ul>
          <h2>Sending messages</h2>
          <p>
            Messages are sent by the client through a frame of the form:
            <br />
            <code>{"{ 3: [ message, … ] }"}</code> where each{" "}
            <code>message</code> is one of:
          </p>
          <ul>
            <li>
              An inbox message:
              <br />
              <code>
                {
                  "{ 0: payload(UInt8Array|null),\n  1: sessionID(UInt8Array),\n  5: expiresAt(uint, Epoch s) }"
                }
              </code>
              , where <code>5</code> is optional.
            </li>
            <li>
              A topic message:
              <br />
              <code>
                {
                  "{ 0: payload(UInt8Array|null),\n  2: topic(UInt8Array),\n  5: expiresAt(uint, Epoch s) }"
                }
              </code>
              , where <code>5</code> is optional.
            </li>
          </ul>
          <p>
            Sending a message “disappears” the previous message from its
            (sender, recipient = topic or inbox) pair (as if those were keys in
            a key-value store, and last write won).
          </p>
          <p>
            As a special case, messages can be unsent using the payload{" "}
            <code>null</code>.
          </p>
          <h2>Acknowledging inbox messages</h2>
          <p>
            Inbox messages are delivered ordered by index; to acknowledge all
            messages up to <code>index</code> to avoid receiving them again on
            reconnection, send a frame of the form:
            <br />
            <code>{"{ 3: index(uint) }"}</code>.
          </p>
          <h2>Consuming topic messages</h2>
          <p>
            To consume messages from a topic, send:
            <br />
            <code>
              {
                "{ 2: topic(UInt8Array),\n  6: maxBacklog(uint),\n  7: oldest(uint, Epoch s),\n  8: continuous(bool) }"
              }
            </code>
            , where <code>5</code> and <code>6</code> are optional and only
            higher bounds from the client as the server might enforce stricter
            limits.
          </p>
          <p>
            All existing messages will arrive in a batch, then messages will
            keep being delivered if you specified continuous delivery with{" "}
            <code>7: true</code>. In that case, to stop the delivery, send{" "}
            <code>{"{ 2: topic(UInt8Array), 7: false }"}</code>.
          </p>
        </details>
        <details>
          <summary>Service</summary>
          <p>
            This instance is hosted by <a href="https://xmit.dev">xmit</a> in
            Europe. It runs on renewable energy.
          </p>
        </details>
        <details>
          <summary>Library</summary>
          <p>
            Eventually:
            <br />
            <code>npm install --save @signali.ng/client</code>
          </p>
        </details>
        <details>
          <summary>Testbed</summary>
          <p>Even more eventually…</p>
          <TestBed />
        </details>
      </main>
    </>
  );
}
