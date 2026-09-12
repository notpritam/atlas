import { open, readFile, unlink, writeFile } from 'node:fs/promises';
import { parseArgs, parseEnv } from 'node:util';

const origin = 'https://sandbox-api.paddle.com';
const productFields = {
  name: 'Foundkeep Pro',
  description: 'Automatic tags, summaries and connections for your saved collection. Includes 500 processing credits per month and 2 GB of storage.',
  tax_category: 'saas',
  custom_data: { foundkeep_catalog: 'pro-v1' },
};
const priceFields = {
  name: 'Foundkeep Pro Monthly', description: 'Foundkeep Pro — USD 5 per month',
  unit_price: { amount: '500', currency_code: 'USD' },
  billing_cycle: { interval: 'month', frequency: 1 }, trial_period: null,
  quantity: { minimum: 1, maximum: 1 }, tax_mode: 'external',
  custom_data: { foundkeep_catalog: 'pro-monthly-v1' },
};
class SetupError extends Error {}
const fail = message => { throw new SetupError(message); };
const validId = (id, prefix) => typeof id === 'string' && new RegExp(`^${prefix}_[a-z0-9]{26}$`).test(id);

async function boundedJson(response) {
  if (!response.body) fail('Paddle returned an empty catalog response.');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) fail('Paddle catalog response exceeded its size limit.');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

/** Sandbox-only bootstrap. Preview by default; writes never modify existing catalog entries. */
export async function setupPaddleSandbox({ apiKey, apply = false, fetcher = fetch } = {}) {
  if (typeof apiKey !== 'string' || !/^pdl_sdbx_apikey_[a-z\d]{26}_[a-zA-Z\d]{22}_[a-zA-Z\d]{3}$/.test(apiKey)) {
    fail('Provide a Paddle sandbox API key through the private credential form. Live keys are not accepted.');
  }
  async function request(path, fields) {
    const url = new URL(path, origin);
    if (url.origin !== origin || url.username || url.password || !['/products', '/prices'].includes(url.pathname)) fail('Unsafe Paddle catalog pagination URL.');
    let response;
    try {
      response = await fetcher(url, {
        method: fields ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Paddle-Version': '1' },
        ...(fields ? { body: JSON.stringify(fields) } : {}),
        redirect: 'error', signal: AbortSignal.timeout(20_000),
      });
    } catch { fail('Paddle could not be reached. No request was automatically retried. Re-run the catalog preview before applying again.'); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      fail(`Paddle catalog request failed (HTTP ${response.status}). Check sandbox permissions and account configuration. No request was automatically retried.`);
    }
    try { return await boundedJson(response); }
    catch { fail('Paddle returned an invalid catalog response. No request was automatically retried.'); }
  }
  async function list(path) {
    const items = [], seen = new Set();
    let next = path;
    for (let page = 0; page < 30; page++) {
      if (seen.has(next)) fail('Repeated Paddle catalog pagination URL.');
      seen.add(next);
      const result = await request(next);
      const pagination = result?.meta?.pagination;
      if (!Array.isArray(result?.data) || typeof pagination?.has_more !== 'boolean') fail('Paddle returned an invalid catalog response.');
      items.push(...result.data);
      if (!pagination.has_more) return items;
      if (typeof pagination.next !== 'string') fail('Paddle returned invalid catalog pagination.');
      const nextUrl = new URL(pagination.next, origin);
      if (nextUrl.origin !== origin || nextUrl.pathname !== new URL(path, origin).pathname || nextUrl.username || nextUrl.password) fail('Unsafe Paddle catalog pagination URL.');
      next = nextUrl.href;
    }
    fail('Paddle catalog pagination exceeded the setup limit. Review the catalog before retrying.');
  }
  const products = (await list('/products?status=active&per_page=200')).filter(item => item?.name === productFields.name || item?.custom_data?.foundkeep_catalog === 'pro-v1');
  if (products.length > 1) fail('Found multiple Foundkeep products. Resolve the ambiguity in Paddle before setup.');
  let product = products[0], productAction = 'reuse';
  if (!product) {
    productAction = apply ? 'created' : 'would-create';
    if (apply) {
      product = (await request('/products', productFields)).data;
      if (!product || !validId(product.id, 'pro')) fail('Paddle returned an unexpected product. Review the catalog before retrying.');
    }
  }
  if (product && (!validId(product.id, 'pro') || product.status !== 'active' || product.tax_category !== 'saas')) fail('The Foundkeep product must be an active SaaS product. Review it in Paddle.');
  const prices = product ? await list(`/prices?product_id=${product.id}&status=active&per_page=200`) : [];
  // A different existing price is a decision for the operator, not permission to duplicate it.
  if (prices.length > 1) fail('Found multiple existing prices. Review the Foundkeep price catalog before setup.');
  let price = prices[0], priceAction = 'reuse';
  const validPrice = value => validId(value?.id, 'pri') && value.product_id === product?.id && value.status === 'active'
    && value.unit_price?.amount === '500' && value.unit_price?.currency_code === 'USD'
    && value.billing_cycle?.interval === 'month' && value.billing_cycle?.frequency === 1
    && value.trial_period === null && value.quantity?.minimum === 1 && value.quantity?.maximum === 1
    && value.tax_mode === 'external' && Array.isArray(value.unit_price_overrides) && value.unit_price_overrides.length === 0;
  if (price && !validPrice(price)) fail('The existing price does not match USD 5 monthly, no trial, quantity one, plus applicable tax. Review it in Paddle; setup did not change it.');
  if (!price) {
    priceAction = apply ? 'created' : 'would-create';
    if (apply) {
      price = (await request('/prices', { ...priceFields, product_id: product.id })).data;
      if (!validPrice(price)) fail('Paddle created an unexpected price. Review it before retrying.');
    }
  }
  return {
    environment: 'sandbox',
    product: { action: productAction, ...(product ? { id: product.id } : {}), fields: productFields },
    price: { action: priceAction, ...(price ? { id: price.id } : {}), fields: priceFields },
    revenuecat: { entitlement: 'pro', offering: 'default', package: '$rc_monthly', productIdentifier: price?.id ?? null },
  };
}

async function main() {
  const { values } = parseArgs({ options: {
    'env-file': { type: 'string' }, apply: { type: 'boolean', default: false },
    output: { type: 'string' }, help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('Usage: node scripts/paddle-sandbox.mjs --env-file /absolute/private/paddle-sandbox.env [--apply] [--output /absolute/catalog.json]\nDefaults to preview. Only Paddle sandbox is supported. Requires Products and Prices Read/Write for --apply.');
    return;
  }
  if (!values['env-file']?.startsWith('/')) fail('An absolute private --env-file path is required.');
  const lockPath = values['env-file'] + '.catalog.lock';
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch { fail('Catalog setup is already running, or the private directory is unavailable.'); }
  try {
    const credentials = parseEnv(await readFile(values['env-file'], 'utf8'));
    const report = await setupPaddleSandbox({ apiKey: credentials.PADDLE_SANDBOX_API_KEY, apply: values.apply });
    const json = JSON.stringify(report, null, 2) + '\n';
    if (values.output) await writeFile(values.output, json, { mode: 0o600, flag: 'wx' });
    console.log(json);
  } finally { await lock.close(); await unlink(lockPath); }
}

if (import.meta.main) main().catch(error => {
  console.error(error instanceof SetupError ? error.message : 'Paddle setup could not complete. Check the private credential path and output destination.');
  process.exitCode = 1;
});
