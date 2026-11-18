// A tiny web app to try the agent against:  node scripts/demo-site.mjs [port]  (default 4321)
import http from 'node:http';

const port = Number(process.argv[2] || process.env.DEMO_SITE_PORT || 4321);
const page = (title, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><nav><a href="/">Home</a> | <a href="/login">Login</a></nav><main>${body}</main></body></html>`;

const routes = {
  '/': () => page('Demo Shop', '<h1>Demo Shop</h1><p>Welcome to the demo shop.</p>'),
  '/login': () =>
    page(
      'Login - Demo Shop',
      `<h1>Sign in</h1>
<form id="f">
  <label>Username <input name="u" autocomplete="off"></label><br>
  <label>Password <input name="p" type="password"></label><br>
  <button type="submit">Sign in</button>
</form>
<p id="err" role="alert" hidden></p>
<script>
document.getElementById('f').addEventListener('submit', (e) => {
  e.preventDefault();
  const u = e.target.u.value, p = e.target.p.value;
  if (u === 'alice' && p === 'secret') location.href = '/welcome?u=' + encodeURIComponent(u);
  else { const el = document.getElementById('err'); el.textContent = 'Invalid username or password'; el.hidden = false; }
});
</script>`
    ),
  '/welcome': (url) => {
    const u = (new URL(url, 'http://x').searchParams.get('u') || '').replace(/[<>&"]/g, '');
    return page('Welcome - Demo Shop', `<h1>Welcome, ${u}</h1>`);
  }
};

http
  .createServer((req, res) => {
    const route = routes[new URL(req.url, 'http://x').pathname];
    res.statusCode = route ? 200 : 404;
    res.setHeader('Content-Type', 'text/html');
    res.end(route ? route(req.url) : page('Not found', '<h1>Not found</h1>'));
  })
  .listen(port, () => console.log(`Demo site on http://localhost:${port}`));
