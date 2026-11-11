export function validateHosting(
  config: { rewrites: { source: string; destination: string }[] },
  hosted: boolean,
) {
  const [api, spa] = config.rewrites;
  if (
    config.rewrites.length !== 2 ||
    api.source !== '/api/:path*' ||
    spa.source !== '/(.*)' ||
    spa.destination !== '/index.html'
  )
    throw new Error('API forwarding must precede the SPA fallback');
  const target = new URL(api.destination);
  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.port ||
    (!target.hostname.endsWith('.onrender.com') && !target.hostname.endsWith('.invalid')) ||
    target.pathname !== '/api/:path*'
  )
    throw new Error('Configure an exact HTTPS Render API rewrite target');
  if (hosted && target.hostname.endsWith('.invalid'))
    throw new Error('Set the actual Render API hostname in apps/web/vercel.json before deploying');
}
