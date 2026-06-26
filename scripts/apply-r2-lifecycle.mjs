#!/usr/bin/env node
/**
 * Apply the R2 object-lifecycle rules (supabase/r2/lifecycle.json) to the bucket
 * via the S3 PutBucketLifecycleConfiguration API. Dependency-free: SigV4 is signed
 * with Node's crypto. Reads R2 creds from setup.env (gitignored).
 *
 *   node scripts/apply-r2-lifecycle.mjs
 */
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- load setup.env ---
const env = {};
for (const line of readFileSync(join(ROOT, 'setup.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/\s+#.*$/, '').trim();
}
const ENDPOINT = (env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`).replace(/\/$/, '');
const BUCKET = env.R2_BUCKET;
const AK = env.R2_ACCESS_KEY_ID;
const SK = env.R2_SECRET_ACCESS_KEY;
if (!BUCKET || !AK || !SK) { console.error('✗ setup.env missing R2 creds'); process.exit(1); }

// --- build the S3 lifecycle XML from lifecycle.json ---
const cfg = JSON.parse(readFileSync(join(ROOT, 'supabase/r2/lifecycle.json'), 'utf8'));
const xml =
  '<LifecycleConfiguration>' +
  cfg.Rules.map((r) => {
    let body = `<ID>${r.ID}</ID><Filter><Prefix>${r.Filter?.Prefix ?? ''}</Prefix></Filter><Status>${r.Status}</Status>`;
    if (r.Expiration?.Days != null) body += `<Expiration><Days>${r.Expiration.Days}</Days></Expiration>`;
    if (r.AbortIncompleteMultipartUpload?.DaysAfterInitiation != null)
      body += `<AbortIncompleteMultipartUpload><DaysAfterInitiation>${r.AbortIncompleteMultipartUpload.DaysAfterInitiation}</DaysAfterInitiation></AbortIncompleteMultipartUpload>`;
    return `<Rule>${body}</Rule>`;
  }).join('') +
  '</LifecycleConfiguration>';

// --- SigV4 (region 'auto', service 's3', path-style) ---
const sha256hex = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, m) => crypto.createHmac('sha256', k).update(m).digest();

function signedHeaders(method, query, body, extra) {
  const host = new URL(ENDPOINT).host;
  const amzdate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const datestamp = amzdate.slice(0, 8);
  const payloadHash = sha256hex(body);
  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzdate, ...extra };
  const keys = Object.keys(headers).map((k) => k.toLowerCase()).sort();
  const canonHeaders = keys.map((k) => {
    const orig = Object.keys(headers).find((h) => h.toLowerCase() === k);
    return `${k}:${String(headers[orig]).trim()}\n`;
  }).join('');
  const signed = keys.join(';');
  const path = `/${BUCKET}`;
  const canonReq = [method, path, query, canonHeaders, signed, payloadHash].join('\n');
  const scope = `${datestamp}/auto/s3/aws4_request`;
  const sts = ['AWS4-HMAC-SHA256', amzdate, scope, sha256hex(canonReq)].join('\n');
  let k = hmac('AWS4' + SK, datestamp);
  k = hmac(k, 'auto'); k = hmac(k, 's3'); k = hmac(k, 'aws4_request');
  const sig = crypto.createHmac('sha256', k).update(sts).digest('hex');
  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${AK}/${scope}, SignedHeaders=${signed}, Signature=${sig}`,
  };
}

const md5 = crypto.createHash('md5').update(xml).digest('base64');
const headers = signedHeaders('PUT', 'lifecycle=', xml, {
  'content-type': 'application/xml',
  'content-md5': md5,
});

const res = await fetch(`${ENDPOINT}/${BUCKET}?lifecycle`, { method: 'PUT', headers, body: xml });
if (res.status === 200) {
  console.log('✓ R2 lifecycle rules applied:');
  for (const r of cfg.Rules) console.log(`    ${r.ID}`);
} else {
  console.error(`✗ PutBucketLifecycle failed: ${res.status}\n${await res.text()}`);
  process.exit(1);
}
