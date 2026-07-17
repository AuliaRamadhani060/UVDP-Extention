// Packaging store build (U6) — memaketkan dist/<target> menjadi .zip siap unggah
// dan MEMVERIFIKASI isinya (bukan sekadar meng-zip):
//  - manifest.json valid & versi cocok dengan package.json
//  - semua berkas yang dirujuk manifest benar-benar ada di paket
//  - tak ada sourcemap (.map) yang ikut terbawa
//  - CSP wasm ada; tak ada URL remote di script HTML (MV3 melarang remote code)
//
// Pakai:  node scripts/package.mjs chrome|firefox
import { existsSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';

const target = process.argv[2];
if (!['chrome', 'firefox'].includes(target)) {
  console.error('Pakai: node scripts/package.mjs chrome|firefox');
  process.exit(1);
}

const root = process.cwd();
const dist = join(root, 'dist', target);
const outZip = join(root, 'dist', `uvpd-${target}.zip`);

if (!existsSync(dist)) {
  console.error(`✗ ${relative(root, dist)} tidak ada. Jalankan: npm run build:store:${target}`);
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const files = walk(dist);
const rel = (p) => relative(dist, p).replace(/\\/g, '/');
const names = new Set(files.map(rel));
const problems = [];

// 1) manifest valid + versi cocok
const manifestPath = join(dist, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('✗ manifest.json tidak ada di paket');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) problems.push(`versi manifest (${manifest.version}) ≠ package.json (${pkg.version})`);
if (manifest.manifest_version !== 3) problems.push('manifest_version bukan 3');

// 2) berkas yang dirujuk manifest harus ada
const refs = [];
const pushRef = (v) => { if (typeof v === 'string' && !/^https?:/.test(v)) refs.push(v.replace(/^\//, '')); };
pushRef(manifest.action?.default_popup);
pushRef(manifest.options_ui?.page);
pushRef(manifest.side_panel?.default_path);
pushRef(manifest.sidebar_action?.default_panel);
pushRef(manifest.background?.service_worker);
for (const s of manifest.background?.scripts || []) pushRef(s);
for (const icons of [manifest.icons, manifest.action?.default_icon]) for (const v of Object.values(icons || {})) pushRef(v);
for (const cs of manifest.content_scripts || []) { for (const j of cs.js || []) pushRef(j); for (const c of cs.css || []) pushRef(c); }
for (const war of manifest.web_accessible_resources || []) for (const r of war.resources || []) if (!r.includes('*')) pushRef(r);
for (const r of new Set(refs)) if (!names.has(r)) problems.push(`dirujuk manifest tapi hilang dari paket: ${r}`);

// 3) tak ada sourcemap di paket store
const maps = [...names].filter((n) => n.endsWith('.map'));
if (maps.length) problems.push(`${maps.length} sourcemap ikut terbawa (bangun dengan STORE=1)`);

// 4) CSP wasm + tak ada script remote
const csp = manifest.content_security_policy?.extension_pages || '';
if (!csp.includes("script-src 'self'")) problems.push("CSP extension_pages tak membatasi script-src ke 'self'");
if (!csp.includes('wasm-unsafe-eval')) problems.push("CSP tak punya 'wasm-unsafe-eval' → ffmpeg.wasm takkan jalan");
for (const f of files.filter((p) => p.endsWith('.html'))) {
  const html = readFileSync(f, 'utf8');
  const remote = html.match(/<script[^>]+src=["']https?:\/\/[^"']+/i);
  if (remote) problems.push(`${rel(f)} memuat script remote (dilarang MV3): ${remote[0].slice(0, 60)}`);
}

// 5) offscreen & onboarding hadir (dibuat runtime → tak dirujuk manifest)
for (const must of ['src/offscreen/offscreen.html', 'src/ui/onboarding/onboarding.html']) {
  if (!names.has(must)) problems.push(`berkas wajib hilang: ${must}`);
}

const totalBytes = files.reduce((s, p) => s + statSync(p).size, 0);
console.log(`paket: ${files.length} berkas, ${(totalBytes / 1048576).toFixed(1)} MB (belum dikompres)`);

if (problems.length) {
  console.error('\n✗ Verifikasi paket GAGAL:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

// 6) zip (Compress-Archive di Windows, `zip` di lainnya)
rmSync(outZip, { force: true });
try {
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Compress-Archive -Path '${dist}\\*' -DestinationPath '${outZip}' -Force`], { stdio: 'inherit' });
  } else {
    execFileSync('zip', ['-r', '-q', outZip, '.'], { cwd: dist, stdio: 'inherit' });
  }
} catch (e) {
  console.error('✗ Gagal membuat zip:', e.message);
  process.exit(1);
}

const zipMb = (statSync(outZip).size / 1048576).toFixed(1);
console.log(`✓ Verifikasi lolos. ${relative(root, outZip)} — ${zipMb} MB`);
