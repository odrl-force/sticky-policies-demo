# Sticky Policies

A demo using ODRL, DPV and N3 reasoning, from the **ODRL-FORCE team at KNoWS UGent**.

Follow a hospital research dataset whose conditions travel with it. Visitors change a research request and see **Eyeron run real N3 rules in a browser worker**, derive an ODRL agreement when the evidence supports it, and verify the saved proof against the original inputs.

## Run on localhost

Requires **Node.js 20 or later**. The browser demo starts without installing dependencies. Run `npm ci` to install the RDF tooling needed for tests and the independent envelope verifier with graph comparison and N3 proof replay.

```sh
npm start
```

Open **http://localhost:5173**. Choose a different port with `PORT=8080 npm start`.

The fonts, Eyeron JavaScript runtime and WebAssembly binary are bundled locally. No API keys, backend or runtime network services are needed. Use an HTTP server rather than opening `index.html` as a file: module workers and WebAssembly need HTTP.

## Dataspace framing

The hospital, university and partner lab are participants in an **illustrative research dataspace**. The participant map follows the current story step and shows the latest decision at each exchange boundary. The university first consumes the data and later acts as an onward provider. Its permission is never reused as the partner lab’s permission.

The reasoner demonstrates a possible **policy decision component** alongside a connector. A trust envelope carries the policy, supporting assertions and saved decision proof. Each new recipient/use needs a fresh request; a proof for the university does not authorize the lab. Exported TriG envelopes include the simulated sending and receiving participants as RDF metadata, not authenticated membership claims.

This is a conceptual framing, not a connector integration or implementation of the Dataspace Protocol. It does not provide catalogue discovery, identity or credential verification, contract-negotiation messages, transfers or runtime enforcement. For background, see [IDSA’s usage-control documentation](https://international-data-spaces-association.github.io/DataspaceConnector/Documentation/v6/UsageControl).

## Follow the story

1. **Attach a policy.** The hospital pairs a dataset reference with an ODRL offer: scientific research, at most 30 days of retention, and a duty to preserve the policy.
2. **Check a request.** Adjust the university’s purpose, retention and evidence. Try marketing, consent withdrawal, missing de-identification or declining the onward-sharing policy. Each change runs Eyeron again.
3. **Share it again.** The partner lab gets a fresh request with no ethics approval of its own. Enable its approval to derive a new agreement that references the original policy.

**Inspect proof** shows the exact rules, policy and evidence, conclusions, captured N3 proof and verification report. **Recheck proof** checks that same captured proof against its source inputs; it does not substitute a newly generated proof.

**Inspect the TriG** shows the complete trust envelope, and **Download TriG** saves `cohort-b.trust-envelope.trig` with the `application/trig` media type. The payload is native RDF: three entirely invented observations inside a graph named by a blank node. The policy’s ODRL targets and the DPV evidence refer to that same node.

```trig
@prefix : <https://example.org/access#> .
@prefix odrl: <http://www.w3.org/ns/odrl/2/> .

:envelope :dataGraph _:data; :contextGraph _:context.
_:data :stickyPolicy :policy-b.

_:data {
  :sample-1 :value 12.4 .
}
_:context {
  :policy-b odrl:permission :offered-use .
  :offered-use odrl:target _:data .
}
```

This snippet is simplified; the actual export contains the full policy, request, evidence and conclusion, plus exact N3 replay artifacts. The catalogue identifier `:cohort-b` links to the payload graph with `:dataGraph`. Graph labels such as `_:data` are local identifiers within this RDF dataset, not global identifiers or content hashes. The same label in another downloaded envelope is not automatically the same node.

The envelope contains:

- A default graph with envelope metadata and a link from the payload graph to its sticky policy.
- A blank-node-named payload graph containing the synthetic observations.
- A separate context graph containing the native RDF policy, request and evidence, all referring to the payload graph’s blank node.
- A separate graph of derived conclusions.
- Exact payload/facts/rules/conclusion/proof/audit source artifacts with SHA-256 text digests. N3 rules and proofs are RDF string literals because N3 formulae are not native TriG syntax.

Check a downloaded envelope independently:

```sh
npm ci
npm run verify -- /path/to/cohort-b.trust-envelope.trig
```

The verifier parses TriG with N3.js, checks the source-text digests, and compares the native payload/context and conclusion graphs to the replay artifacts using RDFC-1.0 canonicalization. The comparison binds the payload graph to the policy target and accepts consistent dataset-local blank-node relabeling and RDF reserialization. It then checks the saved proof with Eyeron, derives a fresh conclusion, and compares the declared decision. Hashes and structural checks establish internal consistency; this unsigned envelope does not authenticate its issuer.

## Publish on GitHub Pages

A GitHub Actions workflow is included at `.github/workflows/pages.yml`.

1. Push this project to a GitHub repository, using the `main` branch (or change the workflow's branch filter).
2. In the repository's **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source.
3. Push to `main`, or run **Deploy to GitHub Pages** manually from the Actions tab.
4. After the workflow completes, use the URL shown by the deployment, usually `https://<owner>.github.io/<repository>/`.

The workflow installs the locked RDF tooling, tests the rules and envelope, builds `dist/`, and deploys that directory. All asset paths are relative, including the worker, runtime and fonts, so project subpaths work without a base-URL setting. No Site registration or separate hosting service is required.

To build and preview the deployment locally:

```sh
npm run build
SERVE_DIST=1 npm start
```

You can also publish the contents of `dist/` with any static web host that serves `.wasm` as `application/wasm` and `.js` as JavaScript.

## Rules and trust boundaries

The story adapts Eyeron's [verifiable decision example](https://eyereasoner.github.io/eyeron/playground#example=verifiable-decision). The six N3 rules in `src/policy.js`:

- Match the requester’s ethics approval to the dataset and requested purpose.
- Match given consent to the same dataset and purpose.
- Require recorded de-identification evidence.
- Evaluate the attached policy’s retention limit with `math:notGreaterThan`.
- Match the recipient’s policy acceptance to the attached policy.
- Derive an ODRL agreement only when all checks and the offered purpose match.

ODRL supplies the request, offer, agreement, permission, constraint and duty structure. DPV supplies purpose, consent, justification and safeguard terms. `:stickyPolicy`, `:acceptsPolicy`, `:retentionDays`, `:preservePolicy` and the intermediate check predicates are **local application-profile extensions**, not a general ODRL evaluation standard. The profile uses an explicit commitment to preserve a policy; it does not mechanically prevent policy removal or perform deletion after 30 days.

A successful proof check means that a conclusion follows from the supplied source assertions and rules. It does not establish real consent, legal authorization, issuer authenticity, freshness, or enforcement. Consent is simplified to a cohort-level assertion; the payload contains only invented observations and no real personal data. De-identification is not anonymity. An absent agreement means **permission not established**, not a formally derived prohibition. A no-grant scenario can have a valid proof of its partial deductions; that proof is not a general proof of non-entailment.

The trust envelope is an illustrative, unsigned bundle rather than an implementation of a particular trust-envelope specification. Production use would need authenticated attestations, trusted issuer policies, evidence freshness/revocation handling, and enforcement at each handoff. The checker can report zero trusted proof steps because its source facts match the supplied documents; those documents still require real-world trust.

## Validation

```sh
npm ci
npm test
npm run build
```

The tests run the bundled Eyeron WASM engine. They cover 192 combinations of purpose, safeguards, retention and recipient, fresh-recipient approval, policy-purpose constraints, proof verification, changed-evidence rejection and input validation. Envelope tests additionally cover native TriG graph/target identity, blank-node relabeling, payload tampering, a detached policy target, artifact integrity, declared-decision mismatches, and a verifiable no-grant export.

## Source map

- `index.html`, `src/style.css`: responsive presentation and story structure.
- `src/app.js`: story state, controls and the proof/envelope inspector.
- `src/envelope.js`: TriG serialization with an actual blank-node-named payload graph.
- `src/policy.js`: N3 rules, policy/request/evidence generation and conclusion interpretation.
- `src/engine-worker.js`: real Eyeron execution off the UI thread.
- `scripts/`: local server, static build and independent envelope verifier with graph comparison and N3 proof replay.
- `public/vendor/eyeron/`: Eyeron 0.8.21 runtime, provenance and MIT license.
- `public/fonts/`: DM Sans and Libre Caslon Display, with their SIL Open Font Licenses.

The graph-label syntax follows [W3C TriG](https://www.w3.org/TR/trig/). This application defines its own envelope profile and extension predicates.

Upstream documentation: [Eyeron](https://github.com/eyereasoner/eyeron), [ODRL](https://www.w3.org/TR/odrl-model/), [DPV](https://w3id.org/dpv/).
