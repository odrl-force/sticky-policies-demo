import { createHash } from "node:crypto";
import { Parser, Store, DataFactory } from "n3";
import canonize from "rdf-canonize";
import { envelopeFormat } from "../src/envelope.js";
import { partitionConclusion } from "../src/report.js";

const { namedNode, blankNode, defaultGraph, quad } = DataFactory;
const ns = "https://example.org/access#";
const ex = (local) => namedNode(ns + local);
const root = ex("envelope");
const defaultTerm = defaultGraph();
const hash = (text) => createHash("sha256").update(text).digest("hex");
function parse(text) {
  return new Parser({ format: "TriG", blankNodePrefix: "" }).parse(text);
}
async function canonical(quads) {
  return canonize.canonize(quads, { algorithm: "RDFC-1.0" });
}
function asDefault(quads) {
  return quads.map((q) => quad(q.subject, q.predicate, q.object, defaultTerm));
}

// Validate native RDF graphs as well as the exact replay artifacts. Graph
// comparisons use RDF canonicalization; they never depend on bnode spelling.
export async function readEnvelope(text) {
  const store = new Store(parse(text));
  function one(subject, predicate) {
    const matches = store.getObjects(subject, ex(predicate), defaultTerm);
    if (matches.length !== 1)
      throw new Error(`Expected exactly one ${predicate} value`);
    return matches[0];
  }
  function string(subject, predicate) {
    const term = one(subject, predicate);
    if (
      term.termType !== "Literal" ||
      term.datatype.value !== "http://www.w3.org/2001/XMLSchema#string"
    )
      throw new Error(`Expected a string for ${predicate}`);
    return term.value;
  }
  if (string(root, "format") !== envelopeFormat)
    throw new Error("Unsupported envelope format");
  const data = one(root, "dataGraph");
  const context = one(root, "contextGraph");
  const decisionGraph = one(root, "decisionGraph");
  const reportGraph = one(root, "reportGraph");
  if (!one(root, "complianceReport").equals(ex("policy-report")))
    throw new Error("Invalid compliance report reference");
  for (const term of [data, context, decisionGraph, reportGraph])
    if (term.termType !== "BlankNode")
      throw new Error("The envelope graphs must be named by blank nodes");
  if (
    new Set([data.value, context.value, decisionGraph.value, reportGraph.value])
      .size !== 4
  )
    throw new Error(
      "Payload, context, decision and report graphs must be distinct",
    );
  const graphs = [data, context, decisionGraph, reportGraph];
  for (const q of store)
    if (
      q.graph.termType !== "DefaultGraph" &&
      !graphs.some((graph) => graph.equals(q.graph))
    )
      throw new Error("Unexpected named graph in envelope");
  const artifacts = {};
  for (const key of [
    "payload",
    "facts",
    "rules",
    "conclusion",
    "report",
    "proof",
    "audit",
  ]) {
    const artifact = one(root, key);
    artifacts[key] = string(artifact, "text");
    if (hash(artifacts[key]) !== string(artifact, "sha256"))
      throw new Error(`Integrity mismatch: ${key}`);
  }
  const policy = one(root, "policy");
  if (!one(data, "stickyPolicy").equals(policy))
    throw new Error("Payload graph policy link mismatch");
  const contextTargets = [ex("offered-use"), ex("research-use-42")];
  const targetPredicate = namedNode("http://www.w3.org/ns/odrl/2/target");
  for (const use of contextTargets) {
    const targets = store.getObjects(use, targetPredicate, context);
    if (targets.length !== 1 || !targets[0].equals(data))
      throw new Error(
        "The policy targets a different graph from the envelope payload",
      );
  }
  const payloadQuads = store.getQuads(null, null, null, data);
  if (!payloadQuads.length) throw new Error("The payload graph is empty");
  const contextQuads = asDefault(store.getQuads(null, null, null, context));
  const sourceFacts = parse(artifacts.facts);
  const sourcePayload = parse(artifacts.payload);
  if (
    [...sourceFacts, ...sourcePayload].some(
      (q) => q.graph.termType !== "DefaultGraph",
    )
  )
    throw new Error("Replay facts and payload must be plain RDF graphs");
  // The source documents share _:data by this demo's profile. After export,
  // every dataset-local bnode may be relabeled without changing its meaning.
  const sourceData = blankNode("data");
  const sourceAnchor = [
    quad(root, ex("dataGraph"), sourceData),
    quad(sourceData, ex("stickyPolicy"), ex("policy-b")),
    quad(root, ex("policy"), ex("policy-b")),
  ];
  const actualAnchor = [
    quad(root, ex("dataGraph"), data),
    quad(data, ex("stickyPolicy"), policy),
    quad(root, ex("policy"), policy),
  ];
  const expected = [
    ...sourceFacts,
    ...sourcePayload.map((q) =>
      quad(q.subject, q.predicate, q.object, sourceData),
    ),
    ...sourceAnchor,
  ];
  const actual = [...contextQuads, ...payloadQuads, ...actualAnchor];
  if ((await canonical(actual)) !== (await canonical(expected)))
    throw new Error(
      "Payload or context graph differs from the source artifacts, or the policy targets a different graph",
    );
  const nativeReport = asDefault(store.getQuads(null, null, null, reportGraph));
  const nativeDecision = asDefault(
    store.getQuads(null, null, null, decisionGraph),
  );
  const expectedConclusion = partitionConclusion(artifacts.conclusion, data);
  if (
    (await canonical(nativeReport)) !==
      (await canonical(expectedConclusion.reports)) ||
    (await canonical(nativeReport)) !==
      (await canonical(parse(artifacts.report)))
  )
    throw new Error(
      "FORCE report graph differs from the derived compliance report",
    );
  if (
    (await canonical(nativeDecision)) !==
    (await canonical(expectedConclusion.decisions))
  )
    throw new Error("Decision graph differs from the recorded conclusion");
  const grantTargets = store.getObjects(
    ex("granted-use-42"),
    targetPredicate,
    decisionGraph,
  );
  if (
    grantTargets.length &&
    (grantTargets.length !== 1 || !grantTargets[0].equals(data))
  )
    throw new Error("Agreement targets a different payload graph");
  const decision = one(root, "decision");
  if (
    decision.termType !== "NamedNode" ||
    !["PermissionEstablished", "PermissionNotEstablished"].some(
      (value) => decision.value === ns + value,
    )
  )
    throw new Error("Invalid declared decision");
  return {
    artifacts,
    decision:
      decision.value === ns + "PermissionEstablished"
        ? "permission-established"
        : "permission-not-established",
  };
}
