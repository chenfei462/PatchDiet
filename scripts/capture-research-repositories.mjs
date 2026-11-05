// Read-only evidence capture. Does not update verification statuses or copy code.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from 'yaml';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const root = path.resolve('knowledge/research');
const registry = parse(await fs.readFile(path.join(root, 'registry.yaml'), 'utf8'));
const evidenceRoot = path.join(root, 'evidence', 'repositories');
await fs.mkdir(evidenceRoot, { recursive: true });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
const captureRoot = process.env.PATCHDIET_RESEARCH_CAPTURE_ROOT || await fs.mkdtemp(path.join(os.tmpdir(), 'patchdiet-research-'));
for (const entry of registry.sources) {
  const source = parse(await fs.readFile(path.join(root, entry.path), 'utf8'));
  if (!source.repository?.startsWith('https://github.com/')) continue;
  const slug = source.repository.replace('https://github.com/', '').replace(/\.git$/, '');
  const file = path.join(evidenceRoot, `${entry.id.replaceAll(':', '-')}.json`);
  try {
    const checkout = path.join(captureRoot, entry.id.replaceAll(':', '-'));
    try { await fs.access(checkout); } catch { git(['clone', '--bare', '--depth=1', '--filter=blob:none', source.repository, checkout]); }
    const sha = git(['rev-parse', 'HEAD'], checkout).trim();
    const branch = git(['symbolic-ref', '--short', 'HEAD'], checkout).trim();
    const files = git(['ls-tree', '-r', '--name-only', sha], checkout).trim().split('\n');
    const licensePath = files.find(name => /^(LICENSE|LICENCE|LIC[AE]N[CS]E|COPYING)(\.md|\.txt|\.rst)?$/i.test(name));
    if (!licensePath) throw new Error('No root license file; manual multi-file license inspection required');
    const licenseText = git(['show', `${sha}:${licensePath}`], checkout);
    const readmePath = files.find(name => /^README\.(md|rst)$/i.test(name));
    const readme = readmePath ? git(['show', `${sha}:${readmePath}`], checkout) : null;
    const readmeUrl = readmePath ? `https://github.com/${slug}/blob/${sha}/${readmePath}` : null;
    const licenseType = /University of Illinois Open Source License/.test(licenseText) ? 'NCSA'
      : /Apache License[\s\S]*Version 2\.0/.test(licenseText) ? 'Apache-2.0'
      : /GNU GENERAL PUBLIC LICENSE[\s\S]*Version 3/.test(licenseText) ? 'GPL-3.0'
      : /GNU LESSER GENERAL PUBLIC LICENSE[\s\S]*Version 3/.test(licenseText) ? 'LGPL-3.0'
      : /Permission is hereby granted, free of charge/.test(licenseText) ? 'MIT' : 'MANUAL_REVIEW_REQUIRED';
    const result = {
      id: entry.id, retrieved_at: '2026-10-26', captured_at_utc: new Date().toISOString(),
      repository: source.repository, default_branch: branch,
      inspected_commit: sha, commit_date: git(['show', '-s', '--format=%cI', sha], checkout).trim(),
      license_path: licensePath, license_type: licenseType,
      license_url: `https://github.com/${slug}/blob/${sha}/${licensePath}`,
      license_sha256: hash(licenseText), license_text: licenseText,
      readme_url: readmeUrl, readme_status: readme ? 'CAPTURED' : 'MISSING',
      readme_sha256: readme === null ? null : hash(readme),
      capture_method: 'git bare shallow blob-filtered clone; git show at fixed SHA',
      previous_pin: source.license_verified_at_commit ?? null,
      note: 'Captured repository artifacts only. Human/independent review determines verification and claim support.'
    };
    await fs.writeFile(file, JSON.stringify(result, null, 2) + '\n');
    if (readme !== null) await fs.writeFile(file.replace(/\.json$/, '.readme.txt'), readme);
    console.log(JSON.stringify({ id: entry.id, commit: sha, license: result.license_type, path: result.license_path, excerpt: licenseText.slice(0, 260) }));
  } catch (error) {
    await fs.writeFile(file, JSON.stringify({ id: entry.id, repository: source.repository, retrieved_at: '2026-10-26', error: String(error) }, null, 2) + '\n');
    console.log(JSON.stringify({ id: entry.id, error: String(error) }));
  }
}
