export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).end();

  const b = {
    web: 'https://azportoex.brudam.com.br',
    webUser: process.env.BRUDAM_PORTO_WEB_USER,
    webPass: process.env.BRUDAM_PORTO_WEB_PASS
  };

  if (!b.webUser || !b.webPass)
    return res.status(200).json({ step: 'env-vars-missing', webUserSet: !!b.webUser, webPassSet: !!b.webPass });

  const result = { webUserSet: true, webPassSet: true };

  try {
    // Tentar login SEM CSRF — ver o que retorna
    const loginNoCsrf = await fetch(b.web + '/brd/sys/login/tms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: b.webUser, password: b.webPass, token: '' })
    });
    const jNoCsrf = await loginNoCsrf.json().catch(() => ({}));
    result.loginNoCsrf = { status: jNoCsrf.status, msg: jNoCsrf.message, uidbrd: jNoCsrf.data?.udata?.uidbrd };

    if (jNoCsrf.status && jNoCsrf.data?.udata?.uidbrd) {
      result.step = 'ok-sem-csrf';
      result.uidbrd = jNoCsrf.data.udata.uidbrd;
      return res.status(200).json(result);
    }

    // Tentar com CSRF da página de login
    const pages = ['/', '/login.php', '/index.php'];
    for (const path of pages) {
      const pageResp = await fetch(b.web + path, { redirect: 'follow' });
      const pageHtml = await pageResp.text();
      const p1 = pageHtml.match(/name="token"[^>]*value="([^"]+)"/)?.[1];
      const p2 = pageHtml.match(/id="token"[^>]*value="([^"]+)"/)?.[1];
      const p3 = pageHtml.match(/"token":\s*"([a-f0-9]{32})"/)?.[1];
      const p4 = pageHtml.match(/var\s+token\s*=\s*['"](\w+)['"]/)?.[1];
      const csrfToken = p1 || p2 || p3 || p4;
      result['page_' + path] = {
        htmlLen: pageHtml.length,
        containsToken: pageHtml.includes('token'),
        csrfFound: !!csrfToken
      };
      if (csrfToken) {
        const loginResp = await fetch(b.web + '/brd/sys/login/tms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: b.webUser, password: b.webPass, token: csrfToken })
        });
        const loginData = await loginResp.json().catch(() => ({}));
        result.loginAttempt = { path, status: loginData.status, msg: loginData.message };
        const uidbrd = loginData.data?.udata?.uidbrd;
        if (uidbrd) { result.step = 'ok'; result.uidbrd = uidbrd; return res.status(200).json(result); }
        result['login_' + path] = loginData.status;
      }
    }
    result.step = 'csrf-not-found-on-any-page';
    return res.status(200).json(result);
  } catch (e) {
    return res.status(200).json({ ...result, step: 'exception', error: e.message });
  }
}