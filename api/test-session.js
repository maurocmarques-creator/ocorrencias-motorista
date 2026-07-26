export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).end();

  const b = {
    web: 'https://azportoex.brudam.com.br',
    webUser: process.env.BRUDAM_PORTO_WEB_USER,
    webPass: process.env.BRUDAM_PORTO_WEB_PASS
  };
  if (!b.webUser || !b.webPass) return res.status(200).json({ step: 'env-vars-missing' });

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  const result = {};

  try {
    // Buscar página com User-Agent de browser
    const pageResp = await fetch(b.web + '/', {
      redirect: 'follow',
      headers: { 'User-Agent': UA }
    });
    const pageHtml = await pageResp.text();
    const tokenMatch = pageHtml.match(/name="token"[^>]*value="([^"]+)"/);
    const csrfToken = tokenMatch?.[1];
    result.htmlLen = pageHtml.length;
    result.csrfFound = !!csrfToken;
    result.htmlStart = pageHtml.substring(0, 150);

    if (!csrfToken) {
      result.step = 'csrf-not-found-mesmo-com-ua';
      return res.status(200).json(result);
    }

    // Tentar login
    const loginResp = await fetch(b.web + '/brd/sys/login/tms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ user: b.webUser, password: b.webPass, token: csrfToken })
    });
    const loginData = await loginResp.json().catch(() => ({}));
    result.loginStatus = loginData.status;
    result.loginMsg = loginData.message;
    const uidbrd = loginData.data?.udata?.uidbrd;
    result.uidbrdObtido = !!uidbrd;
    result.step = uidbrd ? 'ok' : 'login-failed';
    return res.status(200).json(result);
  } catch (e) {
    return res.status(200).json({ ...result, step: 'exception', error: e.message });
  }
}