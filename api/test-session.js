export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).end();

  const base = req.body?.base || 'porto';
  const CONFIGS = {
    porto: {
      web: 'https://azportoex.brudam.com.br',
      webUser: process.env.BRUDAM_PORTO_WEB_USER,
      webPass: process.env.BRUDAM_PORTO_WEB_PASS
    }
  };
  const b = CONFIGS[base];
  const result = { base, webUserSet: !!b?.webUser, webPassSet: !!b?.webPass };

  if (!b?.webUser || !b?.webPass) {
    return res.status(200).json({ ...result, step: 'env-vars-missing' });
  }

  try {
    const pageResp = await fetch(b.web + '/', { redirect: 'follow' });
    const pageHtml = await pageResp.text();
    const tokenMatch = pageHtml.match(/name="token"[^>]*value="([^"]+)"/);
    const csrfToken = tokenMatch?.[1];
    result.csrfFound = !!csrfToken;
    if (!csrfToken) return res.status(200).json({ ...result, step: 'csrf-not-found' });

    const loginResp = await fetch(b.web + '/brd/sys/login/tms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: b.webUser, password: b.webPass, token: csrfToken })
    });
    const loginData = await loginResp.json().catch(() => ({}));
    result.loginStatus = loginData.status;
    result.loginMsg = loginData.message;
    if (!loginData.status) return res.status(200).json({ ...result, step: 'login-failed' });

    const uidbrd = loginData.data?.udata?.uidbrd;
    result.uidbrdObtido = !!uidbrd;
    result.step = uidbrd ? 'ok' : 'uidbrd-not-found';
    return res.status(200).json(result);
  } catch (e) {
    return res.status(200).json({ ...result, step: 'exception', error: e.message });
  }
}