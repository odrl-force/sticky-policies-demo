# Sticky Policies

A demo using ODRL, DPV and N3 reasoning with FORCE compliance reports, from the **ODRL-FORCE team at KNoWS UGent**.

Follow a hospital research dataset whose conditions travel with it. Visitors change a research request and see **Eyeron run real N3 rules in a browser worker**, derive a FORCE compliance report, construct a separate demo agreement when the permission is active, and verify the saved proof against the original inputs.

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

1. **Attach a policy.** The hospital pairs a dataset reference with an ODRL policy (`odrl:Set`): scientific research, at most 30 days of retention, and a duty to preserve the policy.
2. **Check a request.** Adjust the university’s purpose, retention and evidence. Try marketing, consent withdrawal, missing de-identification or declining the onward-sharing policy. Each change runs Eyeron again.
3. **Share it again.** The partner lab gets a fresh request with no ethics approval of its own. Enable its approval to derive a new agreement that is derived from the original policy.

**Inspect proof** shows the exact rules, policy and evidence, conclusions, captured N3 proof and verification report. **Recheck proof** checks that same captured proof against its source inputs; it does not substitute a newly generated proof.

**Inspect the TriG** shows the complete trust envelope, and **Download TriG** saves `cohort-b.trust-envelope.trig` with the `application/trig` media type. **Download report** saves the FORCE compliance report as Turtle.

## Trust envelope

The export follows the [Trust Envelope](https://w3id.org/trustenvelope) model (Slabbinck et al., WOP 2025): one act of sending one data unit to one recipient, with the policy _instantiated_ for that use and provenance for each. Blank nodes name the graphs, which is the pragmatic way to say exactly which triples a future signature would cover.

```trig
:envelope a te:TrustEnvelope;
  dct:issued "2026-10-26T12:00:00Z"^^xsd:dateTime;
  dpv:hasData _:data;
  odrl:hasPolicy :agreement-42;
  te:provenance :data-provenance, :policy-provenance.
:data-provenance a te:DataProvenance;
  te:sender :hospital; eu-dga:hasDataHolder :hospital.
:policy-provenance a te:PolicyProvenance;
  te:recipient :university; te:rightsHolder :hospital;
  :policyGraph _:policy; :evidenceGraph _:evidence; :reportGraph _:report.

_:data   { :sample-1 :value 12.4 . }
_:policy { :offered-use odrl:target _:data .
           :agreement-42 odrl:assignee :university; prov:wasDerivedFrom :policy-b . }
```

This snippet is simplified. The envelope contains:

- A default graph with the `te:TrustEnvelope`, its two provenance nodes and the demo metadata. `te:sign` is omitted because the demo is unsigned.
- `_:data`, the payload graph: three entirely invented observations. The envelope names it with `dpv:hasData`; the policy's `odrl:target` and the DPV evidence use the same node.
- `_:policy`, the hospital's native ODRL policy (an `odrl:Set` linked from the data with `odrl:hasPolicy`) and the derived `odrl:Agreement`, which links back with `prov:wasDerivedFrom`. The agreement is what `odrl:hasPolicy` on the envelope points to, as in the paper.
- `_:evidence`, the FORCE evaluation request, ODRL request and DPV assertions, in a `sotw:SotW` snapshot.
- `_:report`, the N3-derived FORCE compliance report, linked with `:complianceReport`.
- Exact payload/facts/rules/conclusion/report/proof/audit source artifacts with SHA-256 text digests. N3 rules and proofs are RDF string literals because N3 formulae are not native TriG syntax.

Graph labels such as `_:data` are local identifiers within this RDF dataset, not global identifiers or content hashes. The same label in another downloaded envelope is not automatically the same node. A signature would therefore have to cover the RDFC-1.0 canonical form of a graph _together with_ the quads that link it to the envelope.

**Envelopes exist only for Active permissions.** An envelope carries an instantiated policy, so a request whose permission is Inactive gets its compliance report and proof, but no trust envelope.

Check a downloaded envelope independently:

```sh
npm ci
npm run verify -- /path/to/cohort-b.trust-envelope.trig
```

The verifier parses TriG with N3.js, checks the source-text digests and the paper's structure (data and policy provenance, recipient equals the evaluated party and the agreement's assignee), and compares the payload, policy, evidence and report graphs to the replay artifacts using RDFC-1.0 canonicalization. Every blank node in those graphs must be the payload graph's own node. Consistent dataset-local relabeling and RDF reserialization are accepted. It then checks the saved proof with Eyeron and derives a fresh conclusion that must still establish the permission. Hashes and structural checks establish internal consistency; this unsigned envelope does not authenticate its issuer.

## Standards used

**FORCE.** The N3 rules derive a `report:PolicyReport`, a `report:PermissionReport` and nine premise reports (target, action, party and six constraints) from a `sotw:EvaluationRequest` and a `sotw:SotW` snapshot. As the model's README requires, **missing information counts as not satisfied**: the snapshot is a closed world, so a premise with no supporting evidence is `Unsatisfied` and the permission `Inactive`. The negation (`log:notIncludes`) only inspects asserted facts, never derived ones, so it does not depend on rule order. The proof checker records each such absence as a _trusted obligation_; it checks that the conclusion follows from the facts and rules, not that the facts are complete. Evidence arrives as `sotw:context` records linked to their constraint with `sotw:conditionID`, and each constraint's `leftOperand`, `operator` and `rightOperand` must match what the rules evaluate. Not covered: the generic FORCE evaluation of arbitrary policies, duties as pre-conditions (`report:conditionReport`), and the agreement-instantiation algorithm. The onward-sharing duty is not evaluated.

**ODRL.** Policies use `odrl:Set`, `odrl:Request` and `odrl:Agreement` with `odrl:uid`, `odrl:profile`, `odrl:hasPolicy` and `odrl:purpose`. The research profile's own terms (`:retentionDays`, `:matchingConsent` and others, `:preservePolicy`) are declared in the policy graph as `odrl:LeftOperand` and `odrl:Action`, but the profile itself has no published document.

**DPV.** `dpv:Consent` with `hasConsentStatus`, `hasData`, `hasPurpose`, `ScientificResearch`, `Deidentification` and `hasOutcome` are DPV 2 terms. Ethics approval has no core DPV term and is a local `:EthicsApproval`.

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

## FORCE evaluation and compliance reports

The evaluation uses these FORCE models:

- [Contextual Inputs for ODRL Evaluators](https://spec.knows.idlab.ugent.be/sotw/latest/) (living document, 18 December 2025): `sotw:EvaluationRequest`, evaluated party/action/target, request parameters and `sotw:SotW` context.
- [ODRL Compliance Report Model](https://github.com/odrl-force/ODRL-Compliance-Report-Model/blob/main/ComplianceReportModel.ttl) (vocabulary version 0.9.0, inspected 2026-10-26): `report:PolicyReport`, `report:PermissionReport`, premise reports and the satisfaction, activation, attempt, performance and deontic states.

Every report state is derived by the N3 rules in `src/policy.js`. JavaScript assembles the inputs/program and parses the returned RDF; it does not calculate premise truth values or infer Active from the existence of an agreement.

The program evaluates one fixed research-policy profile. Nine premise reports cover target, action, party, purpose, ethics approval, consent, de-identification, retention and policy acceptance. All nine must be `report:Satisfied` for `report:Active`. Any `report:Unsatisfied` premise derives `report:Inactive`. Explicit negative snapshot assertions record missing approval/safeguard evidence or declined acceptance; consent withdrawal and purpose/retention mismatches are also evaluated in N3. Missing information without an explicit negative status remains unreported, so no Active conclusion follows. Contradictory report states are rejected by the interface and verifier.

A matching party/action/target request is `report:Attempted`. This means a request exists, not that the data was used. The declared snapshot has no action-performance observations; performance stays `report:Unknown` and the deontic state stays `report:NonSet`. The demo never infers `report:Performed`, `report:Fulfilled` or `report:Violated` from policy acceptance.

The policy's future onward-sharing obligation is **not evaluated**. Acceptance is a separate, explicit permission constraint. The policy report declares `:evaluationScope :PermissionActivationOnly` and `:notEvaluatedRule :carry-policy`, so machine-readable consumers can see this limitation too. There is no duty report claiming preservation occurred.

For compatibility with the current report vocabulary (`report:policyRequest` and `report:ruleRequest` expect ODRL request structures), the facts retain an `odrl:Request` alongside the newer `sotw:EvaluationRequest`. The policy report links the latter with the local `:evaluationRequest` predicate. The source `sotw:SotW` uses a fixed illustrative snapshot timestamp, not the machine's live clock.

**Inspect FORCE report** / the **FORCE report** tab shows the actual derived report triples. The main decision card reads the same RDF states with N3.js and displays premise satisfaction, activation, attempt, performance and fulfilment status. The TriG export contains this report as a native graph, and its verifier compares it to the derived source artifact before replaying the full saved proof.

## Rules and trust boundaries

The story builds on Eyeron's [verifiable decision example](https://eyereasoner.github.io/eyeron/playground#example=verifiable-decision). ODRL supplies the policy (`odrl:Set`), request, permission, constraints and separate onward-sharing obligation. DPV supplies the scientific-research purpose, consent status and de-identification evidence. FORCE supplies evaluation/context inputs and the compliance report model. The known custom operands (`:matchingEthicsApproval`, `:matchingConsent`, `:deidentificationEvidence`, `:retentionDays`, `:policyAcceptance`) and policy-preservation action/trigger are documented local application-profile extensions.

A separate N3 rule constructs an agreement only after an Active evaluation. It creates a distinct `:granted-use-42` permission rather than turning the request permission itself into a grant. This is **demo-specific agreement construction**, not the full [FORCE policy-instantiation algorithm](https://w3id.org/force/policy-instantiation). The demo is a FORCE-based subset; it does not claim general FORCE evaluator conformance, support arbitrary policies, evaluate prohibitions or duty performance, or run the full FORCE conformance suite.

A successful proof check means that a conclusion follows from the supplied source assertions and rules. It does not establish real consent, legal authorization, issuer authenticity, freshness, or enforcement. Consent is simplified to a cohort-level assertion; the payload contains only invented observations and no real personal data. De-identification is not anonymity. An absent agreement means **permission not established**, not a formally derived prohibition. An Inactive report is proved from this declared snapshot; it does not establish a real-world prohibition or a general proof of non-entailment.

The trust envelope is an illustrative, unsigned bundle rather than an implementation of a particular trust-envelope specification. Production use would need authenticated attestations, trusted issuer policies, evidence freshness/revocation handling, and enforcement at each handoff. The checker can report zero trusted proof steps because its source facts match the supplied documents; those documents still require real-world trust.

## Validation

```sh
npm ci
npm test
npm run build
```

The tests run the bundled Eyeron WASM engine. They cover 192 combinations of purpose, safeguards, retention and recipient, fresh-recipient approval, policy-purpose constraints, proof verification, changed-evidence rejection and input validation. Envelope tests additionally cover native TriG graph/target identity, blank-node relabeling, payload tampering, a detached policy target, artifact integrity, declared-decision mismatches, native FORCE report tampering, grant/payload identity, and a verifiable no-grant export. FORCE tests cover all nine premises, inactive/incomplete snapshots, Unknown/NonSet performance semantics, action/target/party mismatch, contradictory inputs and RDF prefix aliases.

## Source map

- `index.html`, `src/style.css`: responsive presentation and story structure.
- `src/app.js`: story state, controls and the proof/envelope inspector.
- `src/envelope.js`: TriG serialization with an actual blank-node-named payload graph.
- `src/policy.js`: N3 FORCE evaluation/report rules, policy/request/SotW generation and RDF report interpretation.
- `src/report.js`: projections of the derived compliance report and demo agreement into native RDF graphs.
- `src/vendor/`: locally bundled N3.js parser/serializer and its MIT license.
- `src/engine-worker.js`: real Eyeron execution off the UI thread.
- `scripts/`: local server, static build and independent envelope verifier with graph comparison and N3 proof replay.
- `public/vendor/eyeron/`: Eyeron 0.8.21 runtime, provenance and MIT license.
- `public/fonts/`: DM Sans and Libre Caslon Display, with their SIL Open Font Licenses.

The graph-label syntax follows [W3C TriG](https://www.w3.org/TR/trig/). This application defines its own envelope profile and extension predicates.

Upstream documentation: [Eyeron](https://github.com/eyereasoner/eyeron), [ODRL](https://www.w3.org/TR/odrl-model/), [DPV](https://w3id.org/dpv/), [FORCE](https://w3id.org/force).
