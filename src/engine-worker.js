import init, { runCliReport, version } from "../vendor/eyeron/eyeron.js";
await init();
postMessage({ type: "ready", version: version() });
self.onmessage = ({ data }) => {
  try {
    let output = "";
    const report = JSON.parse(
      runCliReport(JSON.stringify(data.request), (text) => {
        output += text;
      }),
    );
    postMessage({ type: "result", id: data.id, output, report });
  } catch (error) {
    postMessage({ type: "error", id: data.id, message: error.message });
  }
};
