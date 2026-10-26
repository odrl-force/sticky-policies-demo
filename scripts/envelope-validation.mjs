import { createHash } from "node:crypto";
import { Parser, Store, DataFactory } from "n3";
import canonize from "rdf-canonize";
import { envelopeFormat } from "../src/envelope.js";
import { envelopeGraphs } from "../src/report.js";

const { namedNode, defaultGraph, quad } = DataFactory;
const ns = "https://example.org/access#";
const ex = (local) => namedNode(ns + local);
const te = (local) => namedNode("https://w3id.org/trustenvelope#" + local);
const dpv = (local) => namedNode("https://w3id.org/dpv#" + local);
const odrl = (local) => namedNode("http://www.w3.org/ns/odrl/2/" + local);
const sotw = (local) => namedNode("https://w3id.org/force/sotw#" + local);
const dga = (local) => namedNode("https://w3id.org/dpv/legal/eu/dga#" + local);
const rdfType = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
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

// Validate the native RDF graphs as well as the exact replay artifacts. Graph
// comparisons use RDF canonicalization; they never depend on bnode spelling.
export async function readEnvelope(text) {
  const store = new Store(parse(text));
  function one(subject, predicate, graph = defaultTerm) {
    const matches = store.getObjects(subject, predicate, graph);
    if (matches.length !== 1)
      throw new Error(`Expected exactly one ${predicate.value} value`);
    return matches[0];
  }
  function string(subject, predicate) {
    const term = one(subject, predicate);
    if (
      term.termType !== "Literal" ||
      term.datatype.value !== "http://www.w3.org/2001/XMLSchema#string"
    )
      throw new Error(`Expected a string for ${predicate.value}`);
    return term.value;
  }
  if (string(root, ex("format")) !== envelopeFormat)
    throw new Error("Unsupported envelope format");
  if (!store.has(quad(root, rdfType, te("TrustEnvelope"), defaultTerm)))
    throw new Error("The envelope is not a te:TrustEnvelope");

  // The paper's model: data unit, instantiated policy, and two provenance nodes.
  const data = one(root, dpv("hasData"));
  const agreement = one(root, odrl("hasPolicy"));
  if (!agreement.equals(ex("agreement-42")))
    throw new Error("The envelope must carry the derived agreement");
  const provenances = store.getObjects(root, te("provenance"), defaultTerm);
  const dataProvenance = ex("data-provenance");
  const policyProvenance = ex("policy-provenance");
  if (
    provenances.length !== 2 ||
    !provenances.some((p) => p.equals(dataProvenance)) ||
    !provenances.some((p) => p.equals(policyProvenance)) ||
    !store.has(
      quad(dataProvenance, rdfType, te("DataProvenance"), defaultTerm),
    ) ||
    !store.has(
      quad(policyProvenance, rdfType, te("PolicyProvenance"), defaultTerm),
    )
  )
    throw new Error("Expected one data provenance and one policy provenance");
  const sender = one(dataProvenance, te("sender"));
  one(dataProvenance, dga("hasDataHolder"));
  const recipient = one(policyProvenance, te("recipient"));
  one(policyProvenance, te("rightsHolder"));
  const policy = one(policyProvenance, ex("policyGraph"));
  const evidence = one(policyProvenance, ex("evidenceGraph"));
  const report = one(policyProvenance, ex("reportGraph"));
  if (
    !one(policyProvenance, ex("complianceReport")).equals(ex("policy-report"))
  )
    throw new Error("Invalid compliance report reference");
  const graphs = [data, policy, evidence, report];
  for (const term of graphs)
    if (term.termType !== "BlankNode")
      throw new Error("The envelope graphs must be named by blank nodes");
  if (new Set(graphs.map((graph) => graph.value)).size !== 4)
    throw new Error(
      "Payload, policy, evidence and report graphs must be distinct",
    );
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
    const artifact = one(root, ex(key));
    artifacts[key] = string(artifact, ex("text"));
    if (hash(artifacts[key]) !== string(artifact, ex("sha256")))
      throw new Error(`Integrity mismatch: ${key}`);
  }

  // Every graph that talks about the data unit must mean the payload graph's
  // own node, not another blank node that merely looks alike.
  for (const graph of [policy, evidence, report])
    for (const q of store.getQuads(null, null, null, graph))
      for (const term of [q.subject, q.object])
        if (term.termType === "BlankNode" && !term.equals(data))
          throw new Error(
            "The policy targets a different graph from the envelope payload",
          );
  for (const [use, graph] of [
    [ex("offered-use"), policy],
    [ex("granted-use-42"), policy],
    [ex("research-use-42"), evidence],
  ]) {
    const targets = store.getObjects(use, odrl("target"), graph);
    if (targets.length !== 1 || !targets[0].equals(data))
      throw new Error(
        "The policy targets a different graph from the envelope payload",
      );
  }
  if (!store.has(quad(data, odrl("hasPolicy"), ex("policy-b"), policy)))
    throw new Error("The data unit does not point at the sticky policy");

  // The recipient is the evaluated party and the agreement's assignee.
  const evaluated = one(ex("evaluation-42"), sotw("evaluatedParty"), evidence);
  const assignee = one(agreement, odrl("assignee"), policy);
  if (!recipient.equals(evaluated) || !recipient.equals(assignee))
    throw new Error("The recipient differs from the evaluated party");
  if (sender.equals(recipient))
    throw new Error("The sender and recipient must differ");

  // Compare each native graph to the replay artifacts as RDF.
  const same = async (actual, expected, message) => {
    if (
      (await canonical(asDefault(actual))) !==
      (await canonical(asDefault(expected)))
    )
      throw new Error(message);
  };
  const sourcePayload = new Parser({
    format: "Turtle",
    blankNodePrefix: "",
  }).parse(artifacts.payload);
  const sourceFacts = new Parser({
    format: "Turtle",
    blankNodePrefix: "",
  }).parse(artifacts.facts);
  if (!sourcePayload.length || !sourceFacts.length)
    throw new Error("The payload graph is empty");
  await same(
    store.getQuads(null, null, null, data),
    sourcePayload,
    "Payload graph differs from the source artifact",
  );
  const expected = envelopeGraphs(artifacts.facts, artifacts.conclusion, data);
  await same(
    store.getQuads(null, null, null, policy),
    expected.policy,
    "Policy graph differs from the source artifacts",
  );
  await same(
    store.getQuads(null, null, null, evidence),
    expected.evidence,
    "Evidence graph differs from the source artifacts",
  );
  const nativeReport = store.getQuads(null, null, null, report);
  await same(
    nativeReport,
    expected.report,
    "FORCE report graph differs from the derived compliance report",
  );
  await same(
    nativeReport,
    new Parser({ format: "Turtle", blankNodePrefix: "" }).parse(
      artifacts.report,
    ),
    "FORCE report graph differs from the derived compliance report",
  );
  return { artifacts };
}
