import { Parser, Store, DataFactory } from "./vendor/n3.js";

export const prefixes = `@prefix : <https://example.org/access#> .
@prefix odrl: <http://www.w3.org/ns/odrl/2/> .
@prefix dpv: <https://w3id.org/dpv#> .
@prefix math: <http://www.w3.org/2000/10/swap/math#> .
@prefix log: <http://www.w3.org/2000/10/swap/log#> .
@prefix report: <https://w3id.org/force/compliance-report#> .
@prefix sotw: <https://w3id.org/force/sotw#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
`;

export const premiseDefinitions = [
  {
    id: "target-report",
    type: "TargetReport",
    label: "Target is the attached data graph",
  },
  {
    id: "action-report",
    type: "ActionReport",
    label: "Requested action matches the policy",
  },
  {
    id: "party-report",
    type: "PartyReport",
    label: "Evaluation party matches the requester",
  },
  {
    id: "purpose-report",
    type: "ConstraintReport",
    constraint: "offered-purpose",
    label: "Purpose is scientific research",
  },
  {
    id: "ethics-report",
    type: "ConstraintReport",
    constraint: "ethics-required",
    label: "Ethics approval covers this use",
  },
  {
    id: "consent-report",
    type: "ConstraintReport",
    constraint: "consent-required",
    label: "Consent covers this purpose",
  },
  {
    id: "safeguard-report",
    type: "ConstraintReport",
    constraint: "safeguard-required",
    label: "De-identification evidence is supplied",
  },
  {
    id: "retention-report",
    type: "ConstraintReport",
    constraint: "retention-limit",
    label: "Retention is within the policy limit",
  },
  {
    id: "acceptance-report",
    type: "ConstraintReport",
    constraint: "acceptance-required",
    label: "Recipient accepts the attached policy",
  },
];
const basic = `:evaluation-42 a sotw:EvaluationRequest; sotw:evaluatedParty ?who; sotw:evaluatedAction ?action; sotw:evaluatedTarget ?data.
:request-42 odrl:permission :research-use-42.`;
const requestedPurpose = `:evaluation-42 sotw:requestParameter :purpose-parameter.
:purpose-parameter sotw:describesFeature odrl:purpose; sotw:value ?purpose.`;
const satisfied = (id, body) =>
  `{ ${basic}\n${body}\n} => { :${id} report:satisfactionState report:Satisfied. }.\n`;
const unsatisfied = (id, body) =>
  `{ ${basic}\n${body}\n} => { :${id} report:satisfactionState report:Unsatisfied. }.\n`;

// All evaluation states are N3 conclusions. JS assembles the program but does
// not precompute satisfaction or activation. Negative evidence is explicit in
// the finite, declared SotW snapshot; absent information stays unreported.
export const rules = `${prefixes}
# FORCE report structure and provenance. The compatibility ODRL Request is
# linked separately from the newer sotw:EvaluationRequest.
{ ${basic}
  :world a sotw:SotW; dct:issued ?time.
} => {
  :policy-report a report:PolicyReport; report:policy :policy-b;
    report:policyRequest :request-42; :evaluationRequest :evaluation-42;
    :stateOfWorld :world; dct:created ?time; report:ruleReport :permission-report;
    :evaluationScope :PermissionActivationOnly; :notEvaluatedRule :carry-policy.
  :permission-report a report:PermissionReport; report:rule :offered-use;
    report:ruleRequest :research-use-42;
    report:premiseReport ${premiseDefinitions.map((p) => ":" + p.id).join(", ")}.
  ${premiseDefinitions.map((p) => `:${p.id} a report:${p.type}${p.constraint ? "; report:constraint :" + p.constraint : ""}.`).join("\n  ")}
}.

# Structural premises: the offered target and action, and the party/request binding.
${satisfied("target-report", ":offered-use odrl:target ?data. :research-use-42 odrl:target ?data.")}
${unsatisfied("target-report", ":offered-use odrl:target ?target. ?data log:notEqualTo ?target.")}
${unsatisfied("target-report", ":research-use-42 odrl:target ?target. ?data log:notEqualTo ?target.")}
${satisfied("action-report", ":offered-use odrl:action ?action. :research-use-42 odrl:action ?action.")}
${unsatisfied("action-report", ":offered-use odrl:action ?offered. ?action log:notEqualTo ?offered.")}
${unsatisfied("action-report", ":research-use-42 odrl:action ?requested. ?action log:notEqualTo ?requested.")}
${satisfied("party-report", ":research-use-42 odrl:assignee ?who.")}
${unsatisfied("party-report", ":research-use-42 odrl:assignee ?requested. ?who log:notEqualTo ?requested.")}

# Purpose must match both the policy and the compatibility request.
${satisfied(
  "purpose-report",
  `${requestedPurpose}
:offered-purpose odrl:leftOperand odrl:purpose; odrl:operator odrl:eq; odrl:rightOperand ?purpose. :purpose-42 odrl:leftOperand odrl:purpose; odrl:operator odrl:eq; odrl:rightOperand ?purpose.`,
)}
${unsatisfied(
  "purpose-report",
  `${requestedPurpose}
:offered-purpose odrl:rightOperand ?offered. ?purpose log:notEqualTo ?offered.`,
)}
${unsatisfied(
  "purpose-report",
  `${requestedPurpose}
:purpose-42 odrl:rightOperand ?requested. ?purpose log:notEqualTo ?requested.`,
)}

# Evidence is scoped to the evaluated party, data graph and purpose.
${satisfied(
  "ethics-report",
  `${requestedPurpose}
:research-use-42 odrl:assignee ?who.
?who :holdsApproval ?approval. ?approval dpv:hasData ?data; dpv:hasPurpose ?purpose.`,
)}
${unsatisfied("ethics-report", ":world :approvalAvailable false.")}
${unsatisfied(
  "ethics-report",
  `${requestedPurpose}
?who :holdsApproval ?approval. ?approval dpv:hasData ?data; dpv:hasPurpose ?approved.
?purpose log:notEqualTo ?approved.`,
)}
${satisfied(
  "consent-report",
  `${requestedPurpose}
:consent-b a dpv:Consent; dpv:hasData ?data; dpv:hasPurpose ?purpose; dpv:hasConsentStatus dpv:ConsentGiven.`,
)}
${unsatisfied("consent-report", ":consent-b dpv:hasConsentStatus dpv:ConsentWithdrawn.")}
${unsatisfied(
  "consent-report",
  `${requestedPurpose}
:consent-b dpv:hasData ?data; dpv:hasPurpose ?consented.
?purpose log:notEqualTo ?consented.`,
)}
${satisfied("safeguard-report", "?data dpv:hasTechnicalOrganisationalMeasure dpv:Deidentification.")}
${unsatisfied("safeguard-report", ":world :deidentificationAvailable false.")}

# The profile interprets the custom retentionDays operand as whole days.
${satisfied(
  "retention-report",
  `:evaluation-42 sotw:requestParameter :retention-parameter.
:retention-parameter sotw:describesFeature :retentionDays; sotw:value ?days.
:research-use-42 :retentionDays ?days.
:retention-limit odrl:operator odrl:lteq; odrl:rightOperand ?max. ?days math:notGreaterThan ?max.`,
)}
${unsatisfied(
  "retention-report",
  `:evaluation-42 sotw:requestParameter :retention-parameter.
:retention-parameter sotw:describesFeature :retentionDays; sotw:value ?days.
:retention-limit odrl:rightOperand ?max. ?days math:greaterThan ?max.`,
)}
${unsatisfied(
  "retention-report",
  `:retention-parameter sotw:value ?days.
:research-use-42 :retentionDays ?requested.
?days log:notEqualTo ?requested.`,
)}

# Acceptance is a precondition. Actual onward policy preservation is NOT inferred.
${satisfied("acceptance-report", ":research-use-42 :acceptsPolicy ?policy. ?data :stickyPolicy ?policy.")}
${unsatisfied("acceptance-report", ":world :policyAccepted false.")}

# FORCE activation is the conjunction of all premises, not an agreement lookup.
{
  ${premiseDefinitions.map((p) => `:${p.id} report:satisfactionState report:Satisfied.`).join("\n  ")}
} => { :permission-report report:activationState report:Active. }.
{
  :permission-report report:premiseReport ?premise.
  ?premise report:satisfactionState report:Unsatisfied.
} => { :permission-report report:activationState report:Inactive. }.

# An access request is an attempt when party/action/target match the rule.
{
  :target-report report:satisfactionState report:Satisfied.
  :action-report report:satisfactionState report:Satisfied.
  :party-report report:satisfactionState report:Satisfied.
} => { :permission-report report:attemptState report:Attempted. }.
${["target-report", "action-report", "party-report"]
  .map(
    (id) => `{
  :${id} report:satisfactionState report:Unsatisfied.
} => { :permission-report report:attemptState report:NotAttempted. }.`,
  )
  .join("\n")}
{
  :policy-report a report:PolicyReport. :world :usePerformance report:Unknown.
} => {
  :permission-report report:performanceState report:Unknown;
    report:deonticState report:NonSet.
}.

# Separate, DEMO-SPECIFIC agreement construction after a positive evaluation.
# This is not an implementation of the full FORCE instantiation algorithm.
{
  :permission-report report:activationState report:Active.
  :evaluation-42 sotw:evaluatedParty ?who; sotw:evaluatedTarget ?data; sotw:evaluatedAction ?action.
  :research-use-42 odrl:assigner ?holder; :retentionDays ?days.
  ?data :stickyPolicy ?policy.
} => {
  :agreement-42 a odrl:Agreement; odrl:profile :research-profile;
    odrl:assigner ?holder; odrl:assignee ?who; odrl:permission :granted-use-42;
    odrl:obligation :carry-policy; :inheritsPolicy ?policy;
    dct:references :policy-b, :request-42, :policy-report.
  :granted-use-42 a odrl:Permission; odrl:assigner ?holder; odrl:assignee ?who;
    odrl:target ?data; odrl:action ?action; :retentionDays ?days;
    odrl:constraint :offered-purpose, :retention-limit, :ethics-required,
      :consent-required, :safeguard-required, :acceptance-required.
  :request-42 dpv:hasOutcome :agreement-42.
}.
`;

export const defaultState = {
  purpose: "ScientificResearch",
  approval: true,
  consent: true,
  deidentified: true,
  days: 30,
  carry: true,
  recipient: "university",
};
export function createFacts(state) {
  if (
    !["ScientificResearch", "Marketing"].includes(state.purpose) ||
    !["university", "partner-lab"].includes(state.recipient) ||
    !Number.isInteger(state.days) ||
    state.days < 1 ||
    state.days > 90 ||
    ["approval", "consent", "deidentified", "carry"].some(
      (key) => typeof state[key] !== "boolean",
    )
  )
    throw new Error("Invalid request");
  return `${prefixes}
# One fixed illustrative snapshot; no inference depends on the host clock.
:world a sotw:SotW; dct:issued "2026-10-26T09:00:00Z"^^xsd:dateTime;
  sotw:context :consent-b, :safeguard-record, :approval-record, :acceptance-record;
  :approvalAvailable ${state.approval}; :deidentificationAvailable ${state.deidentified};
  :policyAccepted ${state.carry}; :usePerformance report:Unknown.
:approval-record :available ${state.approval}; sotw:conditionID :ethics-required.
:safeguard-record :available ${state.deidentified}; sotw:conditionID :safeguard-required.
:acceptance-record :accepted ${state.carry}; sotw:conditionID :acceptance-required.
:consent-b sotw:conditionID :consent-required.

# The same blank node labels the native payload graph in the TriG envelope.
:cohort-b :dataGraph _:data.
_:data :stickyPolicy :policy-b.
:policy-b a odrl:Set; odrl:profile :research-profile;
  odrl:permission :offered-use; odrl:obligation :carry-policy.
:offered-use a odrl:Permission; odrl:assigner :hospital;
  odrl:target _:data; odrl:action odrl:use;
  odrl:constraint :offered-purpose, :retention-limit, :ethics-required,
    :consent-required, :safeguard-required, :acceptance-required.
:offered-purpose a odrl:Constraint; odrl:leftOperand odrl:purpose;
  odrl:operator odrl:eq; odrl:rightOperand dpv:ScientificResearch.
:retention-limit a odrl:Constraint; odrl:leftOperand :retentionDays;
  odrl:operator odrl:lteq; odrl:rightOperand 30.
:ethics-required a odrl:Constraint; odrl:leftOperand :matchingEthicsApproval; odrl:operator odrl:eq; odrl:rightOperand true.
:consent-required a odrl:Constraint; odrl:leftOperand :matchingConsent; odrl:operator odrl:eq; odrl:rightOperand true.
:safeguard-required a odrl:Constraint; odrl:leftOperand :deidentificationEvidence; odrl:operator odrl:eq; odrl:rightOperand true.
:acceptance-required a odrl:Constraint; odrl:leftOperand :policyAcceptance; odrl:operator odrl:eq; odrl:rightOperand true.
# Future onward-sharing obligation; this demo does not evaluate its performance.
:carry-policy a odrl:Duty; odrl:action :preservePolicy; odrl:target :policy-b;
  odrl:constraint :onward-sharing-trigger.
:onward-sharing-trigger a odrl:Constraint; odrl:leftOperand :onwardSharing;
  odrl:operator odrl:eq; odrl:rightOperand true.

# FORCE evaluation input plus an ODRL Request for report-model compatibility.
:evaluation-42 a sotw:EvaluationRequest; sotw:evaluatedParty :${state.recipient};
  sotw:evaluatedAction odrl:use; sotw:evaluatedTarget _:data;
  sotw:requestParameter :purpose-parameter, :retention-parameter.
:purpose-parameter a sotw:RequestParameter; sotw:describesFeature odrl:purpose;
  sotw:value dpv:${state.purpose}.
:retention-parameter a sotw:RequestParameter; sotw:describesFeature :retentionDays;
  sotw:value ${state.days}.
:request-42 a odrl:Request; odrl:profile :research-profile; odrl:permission :research-use-42.
:research-use-42 a odrl:Permission; odrl:assigner :hospital;
  odrl:assignee :${state.recipient}; odrl:target _:data; odrl:action odrl:use;
  odrl:constraint :purpose-42; :retentionDays ${state.days}.
:purpose-42 a odrl:Constraint; odrl:leftOperand odrl:purpose; odrl:operator odrl:eq;
  odrl:rightOperand dpv:${state.purpose}.

# Illustrative DPV assertions, not authenticated attestations.
${
  state.approval
    ? `:${state.recipient} :holdsApproval :eth-2026-118.
:eth-2026-118 dpv:hasData _:data; dpv:hasPurpose dpv:ScientificResearch.`
    : "# No ethics approval supplied for this recipient."
}
:consent-b a dpv:Consent; dpv:hasData _:data; dpv:hasPurpose dpv:ScientificResearch;
  dpv:hasConsentStatus dpv:${state.consent ? "ConsentGiven" : "ConsentWithdrawn"}.
${state.deidentified ? "_:data dpv:hasTechnicalOrganisationalMeasure dpv:Deidentification." : "# No de-identification evidence supplied."}
${state.carry ? ":research-use-42 :acceptsPolicy :policy-b." : "# Recipient has not accepted the attached policy."}
`;
}

// Parse actual RDF terms. Prefix aliases, comments and literal text cannot
// impersonate FORCE states, and contradictory states fail closed.
export function interpret(output) {
  const { namedNode, defaultGraph } = DataFactory;
  const ex = (name) => namedNode("https://example.org/access#" + name);
  const report = (name) =>
    namedNode("https://w3id.org/force/compliance-report#" + name);
  const store = new Store(new Parser({ format: "Turtle" }).parse(output));
  const stateOf = (subject, property, permitted) => {
    const values = store.getObjects(
      ex(subject),
      report(property),
      defaultGraph(),
    );
    if (
      values.length > 1 ||
      values.some(
        (value) =>
          value.termType !== "NamedNode" ||
          !permitted.includes(
            value.value.replace(
              "https://w3id.org/force/compliance-report#",
              "",
            ),
          ) ||
          !value.value.startsWith("https://w3id.org/force/compliance-report#"),
      )
    )
      throw new Error(`Invalid or contradictory FORCE ${property}`);
    return values[0]?.value.split("#").pop() || "NotReported";
  };
  const has = (subject, predicate, object) =>
    store.countQuads(
      ex(subject),
      namedNode(predicate),
      object,
      defaultGraph(),
    ) === 1;
  const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  if (store.countQuads(ex("permission-report"), null, null, null)) {
    if (
      !has("policy-report", rdfType, report("PolicyReport")) ||
      !has("permission-report", rdfType, report("PermissionReport")) ||
      !has("policy-report", report("policy").value, ex("policy-b")) ||
      !has("policy-report", report("policyRequest").value, ex("request-42")) ||
      !has(
        "policy-report",
        report("ruleReport").value,
        ex("permission-report"),
      ) ||
      !has("permission-report", report("rule").value, ex("offered-use")) ||
      !has(
        "permission-report",
        report("ruleRequest").value,
        ex("research-use-42"),
      ) ||
      premiseDefinitions.some(
        (p) =>
          !has(p.id, rdfType, report(p.type)) ||
          !has("permission-report", report("premiseReport").value, ex(p.id)) ||
          (p.constraint &&
            !has(p.id, report("constraint").value, ex(p.constraint))),
      )
    )
      throw new Error("Incomplete FORCE compliance report structure");
  }
  const premises = premiseDefinitions.map((p) => ({
    ...p,
    state: stateOf(p.id, "satisfactionState", ["Satisfied", "Unsatisfied"]),
  }));
  const activation = stateOf("permission-report", "activationState", [
    "Active",
    "Inactive",
  ]);
  const attempt = stateOf("permission-report", "attemptState", [
    "Attempted",
    "NotAttempted",
  ]);
  const performance = stateOf("permission-report", "performanceState", [
    "Unknown",
    "Performed",
    "Unperformed",
  ]);
  const deontic = stateOf("permission-report", "deonticState", [
    "NonSet",
    "Fulfilled",
    "Violated",
  ]);
  if (activation === "Active" && premises.some((p) => p.state !== "Satisfied"))
    throw new Error(
      "Active FORCE report has incomplete or unsatisfied premises",
    );
  if (
    activation === "Inactive" &&
    !premises.some((p) => p.state === "Unsatisfied")
  )
    throw new Error("Inactive FORCE report has no unsatisfied premise");
  return {
    allowed: activation === "Active",
    activation,
    attempt,
    performance,
    deontic,
    premises,
    checks: [
      "ethics-report",
      "consent-report",
      "safeguard-report",
      "retention-report",
      "acceptance-report",
    ].map((id) => premises.find((p) => p.id === id).state === "Satisfied"),
  };
}
