export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).end();

  const CONFIGS = {
    porto: {
      web: 'https://azportoex.brudam.com.br',
      webUser: process.env.BRUDAM_PORTO_WEB_USER,
      webPass: process.env.BRUDAM_PORTO_WEB_PASS
    }
  };
  const b = CONFIGS['porto'];
  const result = { webUserSet: !!b?.webUser, webPassSet: !!b?.webPass };

  if (!b?.webUser || !b?.webPass) return res.status(200).json({ ...result, step: 'env-vars-missing' });

  try {
    const pageResp = await fetch(b.web + '/', { redirect: 'follow' });
    const finalUrl = pageResp.url;
    const pageHtml = await pageResp.text();
    
    // Try multiple patterns to find the CSRF token
    const p1 = pageHtml.match(/name="token"[^>]*value="([^"]+)"/)?.[1];
    const p2 = pageHtml.match(/id="token"[^>]*value="([^"]+)"/)?.[1];
    const p3 = pageHtml.match(/value="([a-f0-9]{32})"/)?.[1];
    const p4 = pageHtml.match(/name=\\"token\\".*?value=\\"([^\\]+)\\"/)?.[1];
    
    return res.status(200).json({
      ...result,
      finalUrl,
      htmlLen: pageHtml.length,
      htmlStart: pageHtml.substring(0, 200),
      containsToken: pageHtml.includes('name="token"'),
      containsInput: pageHtml.includes('<input'),
      p1, p2, p3
    });
  } catch (e) {
    return res.status(200).json({ ...result, step: 'exception', error: e.message });
  }
}