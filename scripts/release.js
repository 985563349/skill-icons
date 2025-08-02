import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execSync } from 'node:child_process';

import picocolors from 'picocolors';
import enquirer from 'enquirer';
import semver from 'semver';
import open from 'open';
import { Octokit } from '@octokit/rest';
import newGithubReleaseUrl from 'new-github-release-url';

let versionUpdated = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { prompt } = enquirer;
const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dry: {
      type: 'boolean',
    },
  },
});

const isDryRun = args.dry;

const currentVersion = createRequire(import.meta.url)('../package.json').version;
const packages = fs.readdirSync(path.resolve(__dirname, '../packages')).filter((p) => {
  const pkgRoot = path.resolve(__dirname, '../packages', p);

  if (fs.statSync(pkgRoot).isDirectory()) {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(pkgRoot, 'package.json'), 'utf-8'));
    return !pkg.private;
  }
});
const releaseTypes = ['major', 'minor', 'patch'];

function run(command, options) {
  return execSync(command, { encoding: 'utf8', ...options });
}

function dryRun(command) {
  console.log(picocolors.cyan(`[dryrun] ${command}`));
}

const runIfNotDry = isDryRun ? dryRun : run;

function inc(release) {
  return semver.inc(currentVersion, release);
}

function step(message) {
  console.log(picocolors.cyan(message));
}

function isMainBranch() {
  return run('git branch --show-current').trim() === 'main';
}

function getLatestCommitHash() {
  return run('git rev-parse HEAD').trim();
}

function getRepoInfo() {
  const remote = run('git remote get-url origin').trim();
  const [, owner, repo] = remote.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);

  return { owner, repo };
}

function isWorkspaceClean() {
  return run('git diff').trim() === '';
}

async function isInSyncWithRemote() {
  try {
    const { owner, repo } = getRepoInfo();
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits/main?per_page=1`
    );
    const data = await res.json();

    if (data.sha === getLatestCommitHash()) {
      return true;
    } else {
      const { yes } = await prompt({
        type: 'confirm',
        name: 'yes',
        message: picocolors.red(
          `Local HEAD is not up-to-date with remote. Are you sure you want to continue?`
        ),
      });
      return yes;
    }
  } catch {
    console.error(picocolors.red('Failed to check whether local HEAD is up-to-date with remote.'));
    return false;
  }
}

function updatePackagesVersion(version) {
  // update root package version
  updatePackageVersion(path.resolve(__dirname, '..'), version);
  // update all packages version
  packages.forEach((p) => {
    updatePackageVersion(path.resolve(__dirname, '../packages', p), version);
  });
}

function updatePackageVersion(pkgRoot, version) {
  const pkgPath = path.resolve(pkgRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

  pkg.version = version;

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

function publishPackages(version) {
  const flags = [];

  if (isDryRun) {
    flags.push('--dry-run', '--no-git-checks');
  }

  // publish all packages
  for (const pkg of packages) {
    publishPackage(pkg, version, flags);
  }
}

function publishPackage(pkgName, version, flags) {
  step(`Publishing ${pkgName}...`);

  try {
    run(`pnpm publish --access publish ${flags.join(' ')}`, {
      cwd: path.resolve(__dirname, '../packages', pkgName),
    });
    console.log(picocolors.green(`Successfully published ${pkgName}@${version}`));
  } catch (e) {
    if (e.message?.match(/previously published/)) {
      console.log(picocolors.red(`Skipping already published: ${pkgName}`));
    } else {
      throw e;
    }
  }
}

async function publishGitHubRelease(version) {
  const { owner, repo } = getRepoInfo();
  const token = process.env.GITHUB_TOKEN;

  const changelog = fs.readFileSync(path.resolve(__dirname, '../CHANGELOG.md'), 'utf-8');
  const [, , notes] = new RegExp(
    `# ${version} \\((.*)\\)\\n\\n([\\s\\S]*?)\\n(?:(?:#\\s)|(?:$))`,
    'g'
  ).exec(changelog);

  if (isDryRun) {
    step(`\nDry run - skipping github release...`);
    return;
  }

  if (!token) {
    const url = newGithubReleaseUrl({
      user: owner,
      repo,
      tag: `v${version}`,
      title: `v${version}`,
      body: notes,
    });

    await open(url);
    return;
  }

  const octokit = new Octokit({ auth: token });

  await octokit.repos.createRelease({
    owner,
    repo,
    tag_name: `v${version}`,
    name: `v${version}`,
    body: notes,
  });
}

async function main() {
  if (!isMainBranch()) {
    console.error(picocolors.red('Can only be published on the main branch.'));
    return;
  }

  if (!(await isInSyncWithRemote())) {
    return;
  } else {
    console.log(`${picocolors.green(`✓`)} Commit is up-to-date with remote.\n`);
  }

  let targetVersion = positionals[0];

  if (!targetVersion) {
    // no explicit version, offer suggestions
    const { type } = await prompt({
      type: 'select',
      name: 'type',
      message: 'Select release type',
      choices: releaseTypes.map((i) => `${i} (${inc(i)})`).concat('custom'),
    });

    if (type === 'custom') {
      const { version } = await prompt({
        type: 'input',
        name: 'version',
        message: 'Input custom version',
        initial: currentVersion,
      });
      targetVersion = version;
    } else {
      targetVersion = type.match(/\((.*)\)/)?.[1] ?? '';
    }
  }

  if (!semver.valid(targetVersion)) {
    throw new Error(`Invalid target version: ${targetVersion}`);
  }

  const { confirm } = await prompt({
    type: 'confirm',
    name: 'confirm',
    message: `Releasing v${targetVersion}. Confirm?`,
  });

  if (!confirm) {
    return;
  }

  // update all package versions
  step('\nUpdating packages versions...');
  updatePackagesVersion(targetVersion);
  versionUpdated = true;

  // generate changelog
  step('\nGenerating changelog...');
  run('conventional-changelog -p angular -i CHANGELOG.md -s');

  const { changelog } = await prompt({
    type: 'confirm',
    name: 'changelog',
    message: 'Changelog generated. Does it look good?',
  });

  if (!changelog) {
    return;
  }

  // update pnpm-lock.yaml
  step('\nUpdating lockfile...');
  run('pnpm install --prefer-offline');

  // check if workspace is clean
  if (!isWorkspaceClean()) {
    step('\nCommitting changes...');
    runIfNotDry('git add -A');
    runIfNotDry(`git commit -m "chore(release): release v${targetVersion}"`);
  } else {
    console.log(`${picocolors.green(`✓`)} No changes to commit.\n`);
  }

  // push to github
  step('\nPushing to github...');
  runIfNotDry(`git tag v${targetVersion}`);
  runIfNotDry(`git push origin refs/tags/v${targetVersion}`);
  runIfNotDry('git push');

  // publish github release
  step('\nPublishing github release...');
  await publishGitHubRelease(targetVersion);

  // publish packages
  step('\nBuilding all packages...');
  run('pnpm build');
  step('\nPublishing packages...');
  publishPackages(targetVersion);

  if (isDryRun) {
    console.log(`\nDry run finished - run git diff to see package changes.`);
  }

  console.log();
}

main().catch((e) => {
  if (versionUpdated) {
    // revert to current version on failed releases
    updatePackagesVersion(currentVersion);
  }
  console.error(e);
  process.exit(1);
});
