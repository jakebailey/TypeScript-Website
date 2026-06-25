import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const releasePipelinePath = path.join(root, "build/azure-pipelines/release.yml");
const checkStageCapacity = process.argv.includes("--check-stage-capacity");
const outDir = process.argv.find(arg => !arg.startsWith("--") && arg !== process.argv[0] && arg !== process.argv[1]) || process.env.BUILD_ARTIFACTSTAGINGDIRECTORY;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function collectWorkspacePackages() {
  const packages = new Map();
  for (const dir of fs.readdirSync(path.join(root, "packages"))) {
    const packageJsonPath = path.join(root, "packages", dir, "package.json");
    if (!fs.existsSync(packageJsonPath)) continue;

    const packageJson = readJson(packageJsonPath);
    if (!packageJson.name || packageJson.private) continue;

    packages.set(packageJson.name, {
      dir: path.relative(root, path.dirname(packageJsonPath)),
      packageJson,
    });
  }
  return packages;
}

function dependenciesOnPackedPackages(pkg, packedNames) {
  const dependencies = new Set();
  for (const section of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    for (const dependency of Object.keys(pkg.packageJson[section] || {})) {
      if (packedNames.has(dependency)) dependencies.add(dependency);
    }
  }
  return dependencies;
}

function computeDepths(packages, packageNames) {
  const packageNameSet = new Set(packageNames);
  const memo = new Map();
  const visiting = new Set();

  function depth(name) {
    if (memo.has(name)) return memo.get(name);
    if (visiting.has(name)) throw new Error(`Workspace dependency cycle involving ${name}`);

    visiting.add(name);
    const deps = dependenciesOnPackedPackages(packages.get(name), packageNameSet);
    const value = deps.size === 0 ? 0 : 1 + Math.max(...[...deps].map(depth));
    visiting.delete(name);
    memo.set(name, value);
    return value;
  }

  for (const name of packageNames) depth(name);
  return memo;
}

function validateReleasePipelineStageCapacity(packages) {
  const allPackageNames = [...packages.keys()];
  const maxRequiredDepth = Math.max(0, ...computeDepths(packages, allPackageNames).values());
  const releaseYaml = fs.readFileSync(releasePipelinePath, "utf8");
  const stageNumbers = [...releaseYaml.matchAll(/^\s+-\s+index:\s+(\d+)\s*$/gm)]
    .map(match => Number(match[1]));
  const maxAvailableStage = Math.max(-1, ...stageNumbers);

  if (maxRequiredDepth !== maxAvailableStage) {
    throw new Error(`Workspace publish graph requires stages 0-${maxRequiredDepth}, but ${releasePipelinePath} defines stages 0-${maxAvailableStage}`);
  }

  console.log(`Workspace publish graph requires stages 0-${maxRequiredDepth}; release pipeline defines stages 0-${maxAvailableStage}.`);
  return maxAvailableStage + 1;
}

const packages = collectWorkspacePackages();
const maxStages = validateReleasePipelineStageCapacity(packages);

if (checkStageCapacity) {
  process.exit(0);
}

if (!outDir) {
  throw new Error("Usage: node build/azure-pipelines/pack-changed-packages.mjs <artifact-staging-directory>");
}

function readPreviousPackageJson(pkg) {
  try {
    return JSON.parse(execFileSync("git", ["show", `HEAD~1:${pkg.dir}/package.json`], { encoding: "utf8" }));
  }
  catch {
    return undefined;
  }
}

function versionChanged(pkg) {
  const previous = readPreviousPackageJson(pkg);
  return previous?.version !== pkg.packageJson.version;
}

const changedPackageNames = [...packages.values()]
  .filter(versionChanged)
  .map(pkg => pkg.packageJson.name);

let packed = [];
if (changedPackageNames.length) {
  const packedDir = path.join(outDir, "packed");
  fs.mkdirSync(packedDir, { recursive: true });

  const filters = changedPackageNames.flatMap(name => ["--filter", name]);
  const output = execFileSync("pnpm", ["-r", ...filters, "pack", "--pack-destination", packedDir, "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const parsed = output.trim() ? JSON.parse(output) : [];
  packed = Array.isArray(parsed) ? parsed : [parsed];

  for (const packedPackage of packed) {
    packedPackage.filename = path.join(packedDir, path.basename(packedPackage.filename));
  }
}

packed = packed.filter(pkg => packages.has(pkg.name));
const packedNames = packed.map(pkg => pkg.name);
const packedByName = new Map(packed.map(pkg => [pkg.name, pkg]));
const depths = computeDepths(packages, packedNames);
const manifest = { stages: Array.from({ length: maxStages }, () => []) };
for (let i = 0; i < maxStages; i++) {
  fs.mkdirSync(path.join(outDir, `stage-${i}`), { recursive: true });
}

for (const name of packedNames) {
  const depth = depths.get(name);
  if (depth >= maxStages) {
    throw new Error(`${name} requires publish stage ${depth}, but max stage is ${maxStages - 1}`);
  }

  const packedPackage = packedByName.get(name);
  const filename = path.basename(packedPackage.filename);
  const stageDir = path.join(outDir, `stage-${depth}`);
  fs.mkdirSync(stageDir, { recursive: true });
  fs.copyFileSync(packedPackage.filename, path.join(stageDir, filename));
  manifest.stages[depth].push({
    name,
    version: packedPackage.version,
    filename,
  });
}

fs.writeFileSync(path.join(outDir, "publish-manifest.json"), JSON.stringify(manifest, undefined, 2) + "\n");
fs.rmSync(path.join(outDir, "packed"), { recursive: true, force: true });

for (let i = 0; i < maxStages; i++) {
  const hasPackages = manifest.stages[i].length > 0;
  if (!hasPackages) {
    fs.writeFileSync(path.join(outDir, `stage-${i}`, ".empty"), "");
  }
  console.log(`Stage ${i}: ${manifest.stages[i].map(pkg => `${pkg.name}@${pkg.version}`).join(", ") || "(empty)"}`);
  console.log(`##vso[task.setvariable variable=HasStage${i}]${hasPackages}`);
  console.log(`##vso[task.setvariable variable=HasStage${i};isOutput=true]${hasPackages}`);
}
