import { Parser, Writer, DataFactory } from "./vendor/n3.js";
import { prefixes, premiseDefinitions, policyFacts } from "./policy.js";
const ns = "https://example.org/access#";
const reportSubjects = new Set(
  [
    "policy-report",
    "permission-report",
    ...premiseDefinitions.map((p) => p.id),
  ].map((id) => ns + id),
);
const { blankNode, quad } = DataFactory;
const outputPrefixes = {
  "": ns,
  report: "https://w3id.org/force/compliance-report#",
  sotw: "https://w3id.org/force/sotw#",
  odrl: "http://www.w3.org/ns/odrl/2/",
  dpv: "https://w3id.org/dpv#",
  dct: "http://purl.org/dc/terms/",
  prov: "http://www.w3.org/ns/prov#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
};
const parse = (text) =>
  new Parser({ format: "Turtle", blankNodePrefix: "" }).parse(text);

// The N3 conclusion holds three kinds of statements: the FORCE report, the
// outcome recorded on the request, and the demo agreement. Eyeron scopes the
// source blank node on output, so the granted target is bound back to the
// envelope's payload graph without altering the exact replay artifact.
export function partitionConclusion(output, dataGraph = blankNode("data")) {
  const quads = parse(output);
  const sourceData = quads.find(
    (q) =>
      q.subject.value === ns + "granted-use-42" &&
      q.predicate.value === outputPrefixes.odrl + "target",
  )?.object;
  const bind = (term) =>
    sourceData?.termType === "BlankNode" && term.equals(sourceData)
      ? dataGraph
      : term;
  const reports = [],
    outcomes = [],
    agreement = [];
  for (const q of quads) {
    const bound = quad(bind(q.subject), q.predicate, bind(q.object));
    if (reportSubjects.has(q.subject.value)) reports.push(bound);
    else if (q.subject.value === ns + "request-42") outcomes.push(bound);
    else agreement.push(bound);
  }
  return { reports, outcomes, agreement };
}

// Split the replay facts into the policy and the request/evidence around it.
// The policy part is whatever the policy document describes; the rest is
// evidence about one particular request.
const key = (term) => `${term.termType}:${term.value}`;
const policySubjects = new Set(
  parse(prefixes + policyFacts).map((q) => key(q.subject)),
);
export function partitionFacts(factsText, dataGraph = blankNode("data")) {
  const bind = (term) =>
    term.termType === "BlankNode" && term.value === "data" ? dataGraph : term;
  const policy = [],
    evidence = [];
  for (const q of parse(factsText)) {
    (policySubjects.has(key(q.subject)) ? policy : evidence).push(
      quad(bind(q.subject), q.predicate, bind(q.object)),
    );
  }
  return { policy, evidence };
}

// The three native graphs a trust envelope derives from the replay artifacts.
export function envelopeGraphs(
  factsText,
  output,
  dataGraph = blankNode("data"),
) {
  const facts = partitionFacts(factsText, dataGraph);
  const conclusion = partitionConclusion(output, dataGraph);
  return {
    policy: [...facts.policy, ...conclusion.agreement],
    evidence: [...facts.evidence, ...conclusion.outcomes],
    report: conclusion.reports,
  };
}
export function serializeGraph(quads) {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format: "Turtle", prefixes: outputPrefixes });
    writer.addQuads(quads);
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}
export function complianceReport(output) {
  return serializeGraph(partitionConclusion(output).reports);
}
