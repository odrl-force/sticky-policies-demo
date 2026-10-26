import { rules, createFacts, defaultState, interpret } from "./policy.js";
import { createEnvelope } from "./envelope.js";
import { complianceReport } from "./report.js";

const $ = (id) => document.getElementById(id);
let state = { ...defaultState };
let stage = 1;
let current = null;
let revision = 0;
let timer;
let selectedTab = "rules";
let readyResolve, readyReject;
const ready = new Promise((resolve, reject) => {
  readyResolve = resolve;
  readyReject = reject;
});
// Register the rejection handler immediately, including when the browser blocks WASM.
ready.catch(() => {});
const worker = new Worker(new URL("./engine-worker.js", import.meta.url), {
  type: "module",
});
const pending = new Map();
let requestId = 0;
let engineVersion = "";
const bootTimeout = setTimeout(
  () =>
    failEngine("Eyeron took too long to load. Reload the page to try again."),
  20000,
);
function failEngine(message) {
  clearTimeout(bootTimeout);
  const error = new Error(message);
  readyReject(error);
  for (const { reject, timeout } of pending.values()) {
    clearTimeout(timeout);
    reject(error);
  }
  pending.clear();
}
worker.onerror = (event) =>
  failEngine(
    event.message ||
      "The Eyeron runtime could not load. Reload the page to try again.",
  );
worker.onmessage = ({ data }) => {
  if (data.type === "ready") {
    clearTimeout(bootTimeout);
    engineVersion = data.version;
    readyResolve();
    return;
  }
  const task = pending.get(data.id);
  if (!task) return;
  clearTimeout(task.timeout);
  pending.delete(data.id);
  if (data.type === "error") task.reject(new Error(data.message));
  else if (!data.report.ok)
    task.reject(
      new Error(
        data.report.stderr || "The proof or reasoning check did not pass.",
      ),
    );
  else task.resolve(data);
};
async function engine(args, sources, proof) {
  await ready;
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Reasoning timed out. Reload the page to try again."));
    }, 15000);
    pending.set(id, { resolve, reject, timeout });
    worker.postMessage({
      id,
      request: { args, sources, ...(proof ? { proof } : {}) },
    });
  });
}
function sourcesFor(facts) {
  return [
    { name: "rules.n3", text: rules },
    { name: "facts.n3", text: facts },
  ];
}
const names = ["rules.n3", "facts.n3"];

function setPending() {
  current = null;
  renderExchangeStatus();
  document.querySelector(".decision-card").setAttribute("aria-busy", "true");
  $("decision-title").textContent = "Checking the evidence…";
  $("decision-description").textContent =
    "Eyeron is deriving the consequences of your request.";
  $("decision-symbol").textContent = "⋯";
  $("checks").replaceChildren();
  for (const id of [
    "force-activation",
    "force-attempt",
    "force-performance",
    "force-deontic",
  ])
    $(id).textContent = "…";
  $("proof-status").textContent = "Running N3 rules…";
  $("run-time").textContent = "In your browser";
  $("download-hint").textContent = "Preparing the current decision…";
  for (const id of [
    "download-envelope",
    "inspect-envelope",
    "download-report",
    "inspect-report",
    "inspect-proof",
    "recheck-proof",
  ])
    $(id).disabled = true;
  renderCode();
}
function scheduleRun() {
  clearTimeout(timer);
  const token = ++revision;
  setPending();
  timer = setTimeout(() => run(token), 110);
}
async function run(token) {
  const facts = createFacts(state);
  const snapshot = { ...state };
  const sources = sourcesFor(facts);
  try {
    const start = performance.now();
    const conclusion = await engine(names, sources);
    if (token !== revision) return;
    const proof = await engine(["--proof", ...names], sources);
    if (token !== revision) return;
    // Check the exact captured proof against the exact same source documents.
    const audit = await engine(
      ["--check-proof", "decision.proof.n3", ...names],
      sources,
      { name: "decision.proof.n3", text: proof.output },
    );
    if (token !== revision) return;
    const result = {
      facts,
      state: snapshot,
      output: conclusion.output,
      proof: proof.output,
      audit: audit.output,
      ...interpret(conclusion.output),
      elapsed: Math.round(performance.now() - start),
    };
    result.compliance = await complianceReport(result.output);
    // A trust envelope carries an instantiated policy, so it exists only for
    // an Active permission. A denied request still gets its compliance report.
    result.envelope = result.allowed
      ? await createEnvelope(result, engineVersion)
      : "";
    if (token !== revision) return;
    current = result;
    renderDecision();
    renderCode();
    for (const id of [
      "download-report",
      "inspect-report",
      "inspect-proof",
      "recheck-proof",
    ])
      $(id).disabled = false;
    for (const id of ["download-envelope", "inspect-envelope"])
      $(id).disabled = !result.allowed;
    $("download-hint").textContent = result.allowed
      ? "TriG trust envelope · synthetic payload, agreement, evidence and proof"
      : "No trust envelope: the permission is not Active, so there is no agreement to send. The compliance report explains why.";
  } catch (error) {
    if (token !== revision) return;
    document.querySelector(".decision-card").setAttribute("aria-busy", "false");
    $("decision-title").textContent = "The reasoner needs attention";
    $("decision-description").textContent = error.message;
    $("proof-status").textContent = "No decision available";
    $("exchange-status").textContent =
      "No current exchange decision is available: the reasoner needs attention.";
    $("download-hint").textContent =
      "A report is available after a successful reasoning run.";
    renderCode();
  }
}
function renderExchangeStatus() {
  if (stage === 1) {
    $("exchange-status").textContent =
      "The hospital publishes its conditions. No permission transfers automatically.";
    return;
  }
  const recipient = stage === 3 ? "Partner lab" : "University";
  $("exchange-status").textContent = !current
    ? `${recipient}: evaluating a fresh request at this exchange boundary…`
    : current.allowed
      ? `${recipient}: permission established for this request. The hospital’s original policy remains attached.`
      : `${recipient}: permission not established. The current evidence does not support this exchange.`;
}
function renderDecision() {
  renderExchangeStatus();
  if (!current) return;
  const {
    allowed,
    activation,
    attempt,
    performance,
    deontic,
    premises,
    audit,
    elapsed,
  } = current;
  const card = document.querySelector(".decision-card");
  card.classList.toggle("blocked", !allowed);
  card.setAttribute("aria-busy", "false");
  $("decision-symbol").textContent = allowed ? "✓" : "⤫";
  $("decision-title").textContent =
    activation === "Active"
      ? "Permission active."
      : activation === "Inactive"
        ? "Permission inactive."
        : "Evaluation incomplete.";
  $("decision-description").textContent = allowed
    ? "All premises are satisfied in this snapshot. FORCE reports the permission as Active; a separate demo rule constructs the agreement."
    : activation === "Inactive"
      ? "At least one premise is Unsatisfied in this snapshot. FORCE reports the permission as Inactive, so the demo constructs no agreement."
      : "Some premises have no reported state. No active permission or agreement has been established.";
  for (const [id, value] of [
    ["force-activation", activation],
    ["force-attempt", attempt],
    ["force-performance", performance],
    ["force-deontic", deontic],
  ]) {
    $(id).textContent = value === "NonSet" ? "Not determined (NonSet)" : value;
    $(id).dataset.forceState = value;
  }
  $("checks").replaceChildren(
    ...premises.map((premise) => {
      const li = document.createElement("li");
      if (premise.state === "Unsatisfied") li.className = "failed";
      else if (premise.state === "NotReported") li.className = "unreported";
      const mark = document.createElement("span");
      mark.className = "check-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent =
        premise.state === "Satisfied"
          ? "✓"
          : premise.state === "Unsatisfied"
            ? "–"
            : "?";
      const label = document.createElement("span");
      label.className = "premise-label";
      label.textContent = premise.label;
      const status = document.createElement("span");
      status.className = "premise-state";
      status.textContent =
        premise.state === "NotReported" ? "Not reported" : premise.state;
      li.append(mark, label, status);
      return li;
    }),
  );
  const verified = audit.match(
    /checked(?: with obligations)?: (\d+) steps, (\d+) verified/,
  );
  $("proof-status").textContent = verified
    ? `${verified[2]} proof steps checked`
    : "Proof checked against source inputs";
  $("run-time").textContent = `${elapsed} ms · WASM`;
  $("logic-note").textContent = allowed
    ? stage === 3
      ? "New recipient, fresh FORCE evaluation. An active permission supports a new demo agreement under the original policy."
      : "The report is derived by N3 rules. Attempted means a matching request exists; it does not mean the data was used."
    : "An inactive permission is not a prohibition. Unknown performance means the demo cannot conclude fulfilment or a violation.";
}
function syncForm() {
  $("purpose").value = state.purpose;
  $("days").value = state.days;
  $("days-label").value = `${state.days} ${state.days === 1 ? "day" : "days"}`;
  for (const key of ["approval", "consent", "deidentified", "carry"])
    $(key).checked = state[key];
}
const story = {
  1: [
    "1. The hospital attaches its policy",
    "The hospital is the data provider in this research dataspace. It offers a cohort with a policy describing which uses are acceptable. A catalogue could make that offer discoverable.",
    "The policy travels with the data, instead of staying behind in a terms-of-use page.",
    "Make a request",
  ],
  2: [
    "2. Does the researcher’s request meet the conditions?",
    "The university is a data consumer. At this exchange boundary, its connector could submit a FORCE evaluation request and DPV context. Change the inputs below and inspect the N3-derived compliance report.",
    "A request proposes a use. Only a supported conclusion establishes the permission.",
    "Pass the data on",
  ],
  3: [
    "3. The partner lab needs its own decision.",
    "The university now acts as an onward provider to a partner lab. The trust envelope carries the original policy and proof across this second boundary, but the lab needs its own approval. Turn it on to derive a fresh agreement.",
    "The same policy applies, but the partner needs evidence for its own request.",
    "Start the journey again",
  ],
};
function setStage(next) {
  const previous = stage;
  stage = next;
  if (next !== previous) {
    if (next === 3) {
      state.recipient = "partner-lab";
      state.approval = false;
    } else if (next === 2) {
      state.recipient = "university";
      if (previous === 3) state.approval = true;
    }
    scheduleRun();
  }
  const [title, description, takeaway, button] = story[stage];
  $("story-title").textContent = title;
  $("story-description").textContent = description;
  $("story-takeaway").replaceChildren(
    Object.assign(document.createElement("span"), { textContent: "↗" }),
    document.createTextNode(takeaway),
  );
  $("next-stage").replaceChildren(
    document.createTextNode(button),
    Object.assign(document.createElement("span"), {
      textContent: stage === 3 ? "↺" : "→",
    }),
  );
  $("story-panel").setAttribute("aria-labelledby", `step-${stage}`);
  $("attach-view").hidden = stage !== 1;
  $("request-view").hidden = stage === 1;
  $("request-title").textContent =
    stage === 3 ? "The partner lab’s request" : "The university’s request";
  document.querySelector('[data-preset="research"]').textContent =
    stage === 3 ? "An approved partner" : "Research as planned";
  document.querySelectorAll("[data-stage]").forEach((button) => {
    const active = Number(button.dataset.stage) === stage;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active);
    button.tabIndex = active ? 0 : -1;
  });
  document
    .querySelectorAll("[data-participant-stage]")
    .forEach((participant) => {
      const active = Number(participant.dataset.participantStage) === stage;
      participant.classList.toggle("active", active);
      if (active) participant.setAttribute("aria-current", "step");
      else participant.removeAttribute("aria-current");
    });
  document
    .querySelectorAll("[data-preset]")
    .forEach((button) => button.classList.remove("active"));
  syncForm();
  renderDecision();
}
function reset() {
  state = { ...defaultState };
  setStage(1);
  scheduleRun();
  toast("The example is reset to the hospital’s policy.");
}
$("reset").addEventListener("click", reset);
$("next-stage").addEventListener("click", () => {
  if (stage === 3) reset();
  else setStage(stage + 1);
});
document
  .querySelectorAll("[data-stage]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      setStage(Number(button.dataset.stage)),
    ),
  );
$("request-form").addEventListener("submit", (event) => event.preventDefault());
$("request-form").addEventListener("input", () => {
  state.purpose = $("purpose").value;
  state.days = Number($("days").value);
  for (const key of ["approval", "consent", "deidentified", "carry"])
    state[key] = $(key).checked;
  syncForm();
  document
    .querySelectorAll("[data-preset]")
    .forEach((button) => button.classList.remove("active"));
  scheduleRun();
});
document.querySelectorAll("[data-preset]").forEach((button) =>
  button.addEventListener("click", () => {
    state = {
      ...defaultState,
      recipient: stage === 3 ? "partner-lab" : "university",
    };
    if (button.dataset.preset === "marketing") state.purpose = "Marketing";
    if (button.dataset.preset === "consent") state.consent = false;
    document
      .querySelectorAll("[data-preset]")
      .forEach((item) => item.classList.toggle("active", item === button));
    syncForm();
    scheduleRun();
  }),
);

const fileNames = {
  envelope: "cohort-b.trust-envelope.trig",
  compliance: "compliance-report.ttl",
  rules: "rules.n3",
  facts: "facts.n3",
  output: "decision.n3",
  proof: "decision.proof.n3",
  audit: "verification.txt",
};
function tabContent() {
  if (selectedTab === "rules") return rules;
  if (selectedTab === "facts") return createFacts(state);
  if (selectedTab === "envelope" && current && !current.envelope)
    return "No trust envelope is issued for this request. An envelope carries the agreement derived for one recipient, and the permission is not Active. The compliance report and proof still explain the decision.";
  return (
    current?.[selectedTab] ||
    "The current decision is being prepared. If the reasoner reports an error, reload the page to try again."
  );
}
function renderCode() {
  $("code-filename").textContent = fileNames[selectedTab];
  $("code-content").textContent = tabContent();
}
function selectTab(tab) {
  selectedTab = tab;
  document.querySelectorAll("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.setAttribute("aria-selected", active);
    button.tabIndex = active ? 0 : -1;
    if (active) {
      button.id = "active-inspector-tab";
      $("code-panel").setAttribute("aria-labelledby", button.id);
    } else button.removeAttribute("id");
  });
  renderCode();
}
function openInspector(tab) {
  selectTab(tab);
  if (!$("inspector").open) $("inspector").showModal();
}
$("open-inspector").addEventListener("click", () => openInspector("rules"));
$("inspect-policy").addEventListener("click", () => openInspector("facts"));
$("inspect-report").addEventListener("click", () =>
  openInspector("compliance"),
);
$("inspect-envelope").addEventListener("click", () =>
  openInspector("envelope"),
);
$("inspect-proof").addEventListener("click", () => openInspector("proof"));
$("close-inspector").addEventListener("click", () => $("inspector").close());
$("inspector").addEventListener("click", (event) => {
  if (event.target === $("inspector")) {
    const rect = $("inspector").getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      $("inspector").close();
  }
});
document
  .querySelectorAll("[data-tab]")
  .forEach((button) =>
    button.addEventListener("click", () => selectTab(button.dataset.tab)),
  );
// Standard arrow-key interaction for both tab sets.
document.querySelectorAll("[role=tablist]").forEach((list) =>
  list.addEventListener("keydown", (event) => {
    const tabs = [...list.querySelectorAll("[role=tab]")];
    const index = tabs.indexOf(document.activeElement);
    if (
      index < 0 ||
      !["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)
    )
      return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
            tabs.length;
    tabs[next].click();
    tabs[next].focus();
  }),
);
$("copy-code").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(tabContent());
    toast("Copied to clipboard.");
  } catch {
    toast("Copy is unavailable here. Select the text to copy it.");
  }
});
$("recheck-proof").addEventListener("click", async () => {
  if (!current) return;
  const snapshot = current;
  $("recheck-proof").disabled = true;
  $("audit-note").textContent =
    "Checking this saved proof against its original source inputs…";
  try {
    const result = await engine(
      ["--check-proof", "decision.proof.n3", ...names],
      sourcesFor(snapshot.facts),
      { name: "decision.proof.n3", text: snapshot.proof },
    );
    if (snapshot !== current) return;
    current.audit = result.output;
    selectTab("audit");
    $("audit-note").textContent =
      "Proof checked successfully. The source assertions still require trust in their issuers.";
    toast("The saved proof checks against the original inputs.");
  } catch (error) {
    $("audit-note").textContent = error.message;
  } finally {
    $("recheck-proof").disabled = !current;
  }
});
$("download-report").addEventListener("click", () => {
  if (!current?.compliance) return;
  const url = URL.createObjectURL(
    new Blob([current.compliance], { type: "text/turtle" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "compliance-report.ttl";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("FORCE compliance report downloaded.");
});
$("download-envelope").addEventListener("click", () => {
  if (!current?.envelope) return;
  const url = URL.createObjectURL(
    new Blob([current.envelope], { type: "application/trig" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "cohort-b.trust-envelope.trig";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("TriG trust envelope downloaded.");
});
let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 3600);
}
syncForm();
selectTab("rules");
setStage(1);
scheduleRun();
