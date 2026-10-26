import { Parser, Writer, DataFactory } from "./vendor/n3.js";
import { premiseDefinitions } from "./policy.js";
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
  xsd: "http://www.w3.org/2001/XMLSchema#",
};

export function partitionConclusion(output, dataGraph = blankNode("data")) {
  const quads = new Parser({ format: "Turtle", blankNodePrefix: "" }).parse(
    output,
  );
  // Eyeron scopes the source blank node on output. Bind the granted target back
  // to the envelope's payload graph without altering the exact replay artifact.
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
    decisions = [];
  for (const q of quads) {
    const bound = quad(bind(q.subject), q.predicate, bind(q.object));
    (reportSubjects.has(q.subject.value) ? reports : decisions).push(bound);
  }
  return { reports, decisions };
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
