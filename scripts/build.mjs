import { cp, mkdir, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist");
for (const file of ["index.html", "src", "public"]) {
  await cp(file, file === "public" ? "dist" : `dist/${file}`, {
    recursive: true,
  });
}
console.log("Built dist/ — ready for GitHub Pages.");
