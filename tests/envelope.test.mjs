import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Parser, Writer, Store, DataFactory } from "n3";
import init, { runCliReport } from "../public/vendor/eyeron/eyeron.js";
import { rules, createFacts, defaultState, interpret } from "../src/policy.js";
import { createEnvelope } from "../src/envelope.js";
import { verifyEnvelope } from "../scripts/verify-envelope.mjs";

const { namedNode, blankNode, literal, quad, defaultGraph } = DataFactory;
const ex = (local) => namedNode("https://example.org/access#" + local);
const te = (local) => namedNode("https://w3id.org/trustenvelope#" + local);
const dpv = (local) => namedNode("https://w3id.org/dpv#" + local);
const dga = (local) => namedNode("https://w3id.org/dpv/legal/eu/dga#" + local);
const rdfType = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const odrl = (local) => namedNode("http://www.w3.org/ns/odrl/2/" + local);
await init({
  module_or_path: await readFile(
    new URL("../public/vendor/eyeron/eyeron_bg.wasm", import.meta.url),
  ),
});
function snapshot(changes = {}) {
  const state = { ...defaultState, ...changes };
  const facts = createFacts(state);
  function run(flags = []) {
    let output = "";
    const report = JSON.parse(
      runCliReport(
        JSON.stringify({
          args: [...flags, "rules.n3", "facts.n3"],
          sources: [
            { name: "rules.n3", text: rules },
            { name: "facts.n3", text: facts },
          ],
        }),
        (text) => {
          output += text;
        },
      ),
    );
    assert.equal(report.ok, true, report.stderr);
    return output;
  }
  const output = run();
  return {
    facts,
    state,
    output,
    proof: run(["--proof"]),
    audit: run(["--prove-and-check"]),
    ...interpret(output),
  };
}
const exported = await createEnvelope(
  snapshot(),
  "0.8.21",
  "2026-10-26T12:00:00.000Z",
);
function parse(text) {
  return new Parser({ format: "TriG" }).parse(text);
}
function write(quads) {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format: "TriG" });
    writer.addQuads(quads);
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}
// The three native graphs hang off the policy provenance, as the paper's
// data and policy provenance scope what each signature would cover.
function graph(store, key) {
  return store.getObjects(ex("policy-provenance"), ex(key), defaultGraph())[0];
}
const dataOf = (store) =>
  store.getObjects(ex("envelope"), dpv("hasData"), defaultGraph())[0];
const rewrite = (quads, change) => quads.map((q) => change(q) ?? q);

test("The envelope follows the Trust Envelope model", () => {
  const store = new Store(parse(exported));
  const env = (p) => store.getObjects(ex("envelope"), p, defaultGraph());
  assert.ok(
    store.has(
      quad(ex("envelope"), rdfType, te("TrustEnvelope"), defaultGraph()),
    ),
  );
  assert.equal(env(namedNode("http://purl.org/dc/terms/issued")).length, 1);
  assert.equal(dataOf(store).termType, "BlankNode");
  assert.ok(env(odrl("hasPolicy"))[0].equals(ex("agreement-42")));
  assert.deepEqual(
    env(te("provenance"))
      .map((p) => p.value)
      .sort(),
    [ex("data-provenance").value, ex("policy-provenance").value],
  );
  const one = (s, p) => store.getObjects(s, p, defaultGraph());
  assert.ok(one(ex("data-provenance"), te("sender"))[0].equals(ex("hospital")));
  assert.ok(
    one(ex("data-provenance"), dga("hasDataHolder"))[0].equals(ex("hospital")),
  );
  assert.ok(
    one(ex("policy-provenance"), te("recipient"))[0].equals(ex("university")),
  );
  assert.ok(
    one(ex("policy-provenance"), te("rightsHolder"))[0].equals(ex("hospital")),
  );
  // Unsigned: te:sign is not claimed.
  assert.equal(store.getQuads(null, te("sign"), null, null).length, 0);
});
test("The payload, policy, evidence and report are separate blank-node graphs", () => {
  const store = new Store(parse(exported));
  const graphs = [
    dataOf(store),
    graph(store, "policyGraph"),
    graph(store, "evidenceGraph"),
    graph(store, "reportGraph"),
  ];
  assert.ok(graphs.every((g) => g.termType === "BlankNode"));
  assert.equal(new Set(graphs.map((g) => g.value)).size, 4);
  const inDefault = (p) => store.getQuads(null, p, null, defaultGraph()).length;
  assert.equal(inDefault(odrl("permission")), 0);
  assert.equal(inDefault(ex("value")), 0);
  const [, policy, evidence, report] = graphs;
  assert.ok(
    store.getQuads(ex("offered-use"), odrl("target"), null, policy).length ===
      1,
  );
  assert.ok(
    store.getQuads(ex("research-use-42"), odrl("target"), null, evidence)
      .length === 1,
  );
  assert.ok(
    store.getQuads(ex("permission-report"), null, null, report).length > 0,
  );
});
test("The actual payload graph is blank-node named and is the ODRL and DPV target", () => {
  const store = new Store(parse(exported));
  const data = dataOf(store);
  const policy = graph(store, "policyGraph");
  const evidence = graph(store, "evidenceGraph");
  assert.equal(store.getQuads(null, ex("value"), null, data).length, 3);
  for (const [use, g] of [
    [ex("offered-use"), policy],
    [ex("granted-use-42"), policy],
    [ex("research-use-42"), evidence],
  ])
    assert.ok(store.getObjects(use, odrl("target"), g)[0].equals(data));
  assert.ok(
    store.getObjects(ex("consent-b"), dpv("hasData"), evidence)[0].equals(data),
  );
  assert.ok(
    store.getObjects(data, odrl("hasPolicy"), policy)[0].equals(ex("policy-b")),
  );
  assert.ok(
    store.has(
      quad(
        ex("agreement-42"),
        namedNode("http://www.w3.org/ns/prov#wasDerivedFrom"),
        ex("policy-b"),
        policy,
      ),
    ),
  );
});
test("The complete TriG envelope verifies its graphs and its captured proof", async () => {
  const result = await verifyEnvelope(exported);
  assert.equal(result.decision, "permission-established");
  assert.match(result.audit, /0 failed/);
});
test("An onward envelope from the university to the partner lab verifies", async () => {
  const text = await createEnvelope(
    snapshot({ recipient: "partner-lab" }),
    "0.8.21",
  );
  const store = new Store(parse(text));
  assert.ok(
    store
      .getObjects(ex("data-provenance"), te("sender"), defaultGraph())[0]
      .equals(ex("university")),
  );
  assert.ok(
    store
      .getObjects(ex("policy-provenance"), te("recipient"), defaultGraph())[0]
      .equals(ex("partner-lab")),
  );
  assert.equal((await verifyEnvelope(text)).decision, "permission-established");
});
test("Reserialization and dataset-local blank-node renaming preserve verification", async () => {
  const ids = new Map();
  function rename(term) {
    if (term.termType !== "BlankNode") return term;
    if (!ids.has(term.value))
      ids.set(term.value, blankNode("renamed" + ids.size));
    return ids.get(term.value);
  }
  const relabeled = parse(exported).map((q) =>
    quad(rename(q.subject), q.predicate, rename(q.object), rename(q.graph)),
  );
  const text = await write(relabeled);
  assert.equal((await verifyEnvelope(text)).decision, "permission-established");
});
test("Changing the native payload without changing the source artifact is rejected", async () => {
  const store = new Store(parse(exported));
  const data = dataOf(store);
  const changed = rewrite([...store], (q) =>
    q.graph.equals(data) &&
    q.subject.equals(ex("sample-1")) &&
    q.predicate.equals(ex("value"))
      ? quad(
          q.subject,
          q.predicate,
          literal(
            "99.0",
            namedNode("http://www.w3.org/2001/XMLSchema#decimal"),
          ),
          q.graph,
        )
      : null,
  );
  await assert.rejects(
    () => write(changed).then(verifyEnvelope),
    /Payload graph differs/,
  );
});
test("Pointing the native policy at an unrelated blank node is rejected", async () => {
  const store = new Store(parse(exported));
  const policy = graph(store, "policyGraph");
  const changed = rewrite([...store], (q) =>
    q.graph.equals(policy) &&
    q.subject.equals(ex("offered-use")) &&
    q.predicate.equals(odrl("target"))
      ? quad(q.subject, q.predicate, blankNode("unrelated-data"), q.graph)
      : null,
  );
  await assert.rejects(
    () => write(changed).then(verifyEnvelope),
    /policy targets a different graph/,
  );
});
test("Changing the native policy or evidence without the source artifacts is rejected", async () => {
  const store = new Store(parse(exported));
  const policy = graph(store, "policyGraph");
  const evidence = graph(store, "evidenceGraph");
  const limit = rewrite([...store], (q) =>
    q.graph.equals(policy) &&
    q.subject.equals(ex("retention-limit")) &&
    q.predicate.equals(odrl("rightOperand"))
      ? quad(
          q.subject,
          q.predicate,
          literal("90", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
          q.graph,
        )
      : null,
  );
  await assert.rejects(
    () => write(limit).then(verifyEnvelope),
    /Policy graph differs/,
  );
  const consent = rewrite([...store], (q) =>
    q.graph.equals(evidence) &&
    q.subject.equals(ex("consent-b")) &&
    q.predicate.equals(dpv("hasConsentStatus"))
      ? quad(q.subject, q.predicate, dpv("ConsentWithdrawn"), q.graph)
      : null,
  );
  await assert.rejects(
    () => write(consent).then(verifyEnvelope),
    /Evidence graph differs/,
  );
});
test("A recipient that is not the evaluated party is rejected", async () => {
  const changed = rewrite(parse(exported), (q) =>
    q.subject.equals(ex("policy-provenance")) &&
    q.predicate.equals(te("recipient"))
      ? quad(q.subject, q.predicate, ex("partner-lab"), q.graph)
      : null,
  );
  await assert.rejects(
    () => write(changed).then(verifyEnvelope),
    /recipient differs/,
  );
});
test("Changing the source proof text without its digest is rejected", async () => {
  const changed = rewrite(parse(exported), (q) =>
    q.subject.equals(ex("proof-artifact")) && q.predicate.equals(ex("text"))
      ? quad(
          q.subject,
          q.predicate,
          literal(q.object.value + "\n# altered"),
          q.graph,
        )
      : null,
  );
  await assert.rejects(
    () => write(changed).then(verifyEnvelope),
    /Integrity mismatch: proof/,
  );
});
test("A denied request yields a compliance report but no trust envelope", async () => {
  const denied = snapshot({ consent: false });
  assert.equal(denied.allowed, false);
  await assert.rejects(
    () => createEnvelope(denied, "0.8.21"),
    /only issued when the permission is Active/,
  );
});
test("The envelope carries a native FORCE report and the grant targets the original payload graph", () => {
  const store = new Store(parse(exported));
  const data = dataOf(store);
  const reports = graph(store, "reportGraph");
  const policy = graph(store, "policyGraph");
  const force = (local) =>
    namedNode("https://w3id.org/force/compliance-report#" + local);
  assert.ok(
    store
      .getObjects(ex("permission-report"), force("activationState"), reports)[0]
      .equals(force("Active")),
  );
  assert.equal(
    store.getObjects(ex("permission-report"), force("premiseReport"), reports)
      .length,
    9,
  );
  assert.ok(
    store
      .getObjects(ex("granted-use-42"), odrl("target"), policy)[0]
      .equals(data),
  );
});
test("Changing the native FORCE report cannot substitute for a derived report", async () => {
  const store = new Store(parse(exported));
  const reports = graph(store, "reportGraph");
  const predicate = namedNode(
    "https://w3id.org/force/compliance-report#activationState",
  );
  const changed = rewrite([...store], (q) =>
    q.graph.equals(reports) && q.predicate.equals(predicate)
      ? quad(
          q.subject,
          q.predicate,
          namedNode("https://w3id.org/force/compliance-report#Inactive"),
          q.graph,
        )
      : null,
  );
  await assert.rejects(
    () => write(changed).then(verifyEnvelope),
    /FORCE report graph differs/,
  );
});
