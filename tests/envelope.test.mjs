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
function graph(store, key) {
  return store.getObjects(ex("envelope"), ex(key), defaultGraph())[0];
}

test("The actual payload graph is blank-node named and is the ODRL and DPV target", () => {
  const store = new Store(parse(exported));
  const data = graph(store, "dataGraph");
  const context = graph(store, "contextGraph");
  assert.equal(data.termType, "BlankNode");
  assert.equal(store.getQuads(null, ex("value"), null, data).length, 3);
  assert.ok(
    store
      .getObjects(ex("offered-use"), odrl("target"), context)[0]
      .equals(data),
  );
  assert.ok(
    store
      .getObjects(ex("research-use-42"), odrl("target"), context)[0]
      .equals(data),
  );
  assert.ok(
    store
      .getObjects(
        ex("consent-b"),
        namedNode("https://w3id.org/dpv#hasData"),
        context,
      )[0]
      .equals(data),
  );
});
test("The complete TriG envelope verifies its graphs and its captured proof", async () => {
  const result = await verifyEnvelope(exported);
  assert.equal(result.decision, "permission-established");
  assert.match(result.audit, /0 failed/);
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
  const data = graph(store, "dataGraph");
  const changed = [...store].map((q) =>
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
      : q,
  );
  await assert.rejects(
    () => write(changed).then(verifyEnvelope),
    /Payload or context graph differs/,
  );
});
test("Pointing the native policy at an unrelated blank node is rejected", async () => {
  const store = new Store(parse(exported));
  const context = graph(store, "contextGraph");
  const changed = [...store].map((q) =>
    q.graph.equals(context) &&
    q.subject.equals(ex("offered-use")) &&
    q.predicate.equals(odrl("target"))
      ? quad(q.subject, q.predicate, blankNode("unrelated-data"), q.graph)
      : q,
  );
  await assert.rejects(
    () => write(changed).then(verifyEnvelope),
    /policy targets a different graph/,
  );
});
test("Changing the source proof text without its digest is rejected", async () => {
  const changed = parse(exported).map((q) =>
    q.subject.equals(ex("proof-artifact")) && q.predicate.equals(ex("text"))
      ? quad(
          q.subject,
          q.predicate,
          literal(q.object.value + "\n# altered"),
          q.graph,
        )
      : q,
  );
  await assert.rejects(
    () => write(changed).then(verifyEnvelope),
    /Integrity mismatch: proof/,
  );
});
test("Changing the declared decision cannot substitute for the derived conclusion", async () => {
  const changed = parse(exported).map((q) =>
    q.subject.equals(ex("envelope")) && q.predicate.equals(ex("decision"))
      ? quad(q.subject, q.predicate, ex("PermissionNotEstablished"), q.graph)
      : q,
  );
  await assert.rejects(
    () => write(changed).then(verifyEnvelope),
    /declared decision differs/,
  );
});
test("A request without consent still exports a verifiable no-grant envelope", async () => {
  const text = await createEnvelope(snapshot({ consent: false }), "0.8.21");
  assert.equal(
    (await verifyEnvelope(text)).decision,
    "permission-not-established",
  );
});
