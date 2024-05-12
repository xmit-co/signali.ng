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
              lightweight announcements in topics.
            </li>
            <li>
              Leave privacy to <b>end-to-end encryption</b> as an app-level
              concern (we offer TLS and no topic discovery).
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
            attached to it. Each session holds subscriptions to topics.
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
            At most one message is ever retained by sender and topic, but
            they're guaranteed to be retained until:
          </p>
          <ul>
            <li>
              another message from the same sender and to the same recipient
              replaces them,
            </li>
            <li>they expire, which they all do.</li>
          </ul>
          <p>
            Sessions recovered after a disconnection continue where they left
            off: previously sent messages need not be resent, and topic
            subscriptions <em>restart</em> (rather than resume: once again, a
            backlog of at most one fresh message per sender is transmitted
            according to the subscription settings, before new messages are
            transmitted live).
          </p>
          <h2>Limits (subject to change)</h2>
          <ul>
            <li>
              Sessions can subscribe to at most 100 topics and are preserved for
              at most 1 hour without connections.
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
            <code>{"{ 0: [ { 0: message(string), … }, … ] }"}</code> are lists
            of errors.
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
                "{ 0: errors[]?,\n  1: sessionID(UInt8Array),\n  2: recoveryKey(UInt8Array),\n  3: messages(Message[]?),\n  10: maxExpiration(uint?, s),\n  11: maxMessageSize(uint?) }"
              }
            </code>
            .
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
            Server frames containing messages expose them under the key{" "}
            <code>3</code>, in an array of maps, as seen above. Those maps take
            the form:
            <br />
            <code>
              {
                "{ 0: payload(UInt8Array),\n  1: sessionID(UInt8Array),\n  2: topic(UInt8Array),\n  3: expiresAt(uint, Epoch s)\n  10: sentAt(uint, Epoch s) }"
              }
            </code>
            .
          </p>
          <h2>Receiving from topics</h2>
          <p>
            To receive messages from a topic, send:
            <br />
            <code>
              {
                "{ 2: topic(UInt8Array),\n  6: maxBacklog(uint?),\n  7: oldest(uint?, Epoch s),\n  8: continuous(bool?) }"
              }
            </code>
            , where <code>6</code> and <code>7</code> are only higher bounds
            from the client as the server might enforce stricter limits.
          </p>
          <p>
            Existing messages that fit the constraints in <code>6</code> and{" "}
            <code>7</code> will arrive in a single batch, then messages will
            keep being delivered if you specified continuous delivery with{" "}
            <code>8: true</code>. In that case, to stop the delivery, send{" "}
            <code>{"{ 2: topic(UInt8Array), 8: false }"}</code>.
          </p>
          <h2>Sending messages</h2>
          <p>
            Messages are sent by the client through a frame of the form:
            <br />
            <code>{"{ 3: [ message, … ] }"}</code> where each{" "}
            <code>message</code> takes the form:
            <br />
            <code>
              {
                "{ 0: payload(UInt8Array|null),\n  2: topic(UInt8Array),\n  3: expiresAt(uint?, Epoch s) }"
              }
            </code>
            .
          </p>
          <p>
            Sending a message “disappears” the previous message from its
            (sender, topic) pair (as if those were keys in a key-value store,
            and last write won).
          </p>
          <p>
            As a special case, messages can be unsent using the payload{" "}
            <code>null</code>.
          </p>
        </details>
        <details>
          <summary>Service</summary>
          <p>
            This service is hosted by <a href="https://xmit.dev">xmit</a> in
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
