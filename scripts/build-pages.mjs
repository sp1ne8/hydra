import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { relative, resolve } from "node:path";

const project = fileURLToPath(new URL("../", import.meta.url));
const source = resolve(project, "public");
const output = resolve(project, "pages-dist");
if (relative(project, output) !== "pages-dist") {
  throw new Error("Invalid GitHub Pages output path.");
}

const pages = [
  "index.html",
  "catalog.html",
  "product.html",
  "faq.html",
  "privacy-policy.html",
  "terms.html",
  "404.html",
];
const authScript = '<script src="/assets/js/auth.js" type="module"></script>';
const accountStart = '<div class="account-nav" data-account-nav>';

function replaceAccountNavigation(html, name) {
  const start = html.indexOf(accountStart);
  if (start < 0 || !html.includes(authScript)) {
    throw new Error(`Account navigation is missing from ${name}.`);
  }

  const tags = /<\/?div\b[^>]*>/g;
  let depth = 0;
  let end = -1;
  for (const match of html.slice(start).matchAll(tags)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) {
      end = start + match.index + match[0].length;
      break;
    }
  }
  if (end < 0) throw new Error(`Account navigation is incomplete in ${name}.`);

  const previewLink = '<a class="button" href="./catalog.html">Смотреть каталог</a>';
  return (html.slice(0, start) + previewLink + html.slice(end)).replace(
    /^[ \t]*<script src="\/assets\/js\/auth\.js" type="module"><\/script>\r?\n/m,
    "",
  );
}

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "assets", "js"), { recursive: true });
for (const folder of ["downloads", "fonts", "images", "media"]) {
  await cp(resolve(source, "assets", folder), resolve(output, "assets", folder), {
    recursive: true,
  });
}
await mkdir(resolve(output, "assets", "css"), { recursive: true });
for (const name of [
  "main.css",
  "theme.css",
  "base.css",
  "navigation.css",
  "storefront.css",
  "motion.css",
  "custom.css",
]) {
  await cp(
    resolve(source, "assets", "css", name),
    resolve(output, "assets", "css", name),
  );
}
await cp(
  resolve(source, "assets", "js", "ui.js"),
  resolve(output, "assets", "js", "ui.js"),
);

for (const name of pages) {
  let html = replaceAccountNavigation(
    await readFile(resolve(source, name), "utf8"),
    name,
  );
  if (name === "404.html") {
    html = html.replace("<head>", '<head><base href="/hydra/" />');
  }
  await writeFile(resolve(output, name), html);
}
await writeFile(resolve(output, ".nojekyll"), "");
