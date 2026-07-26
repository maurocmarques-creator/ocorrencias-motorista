const BASES = {
  porto: {
    web:     'https://azportoex.brudam.com.br',
    webUser: process.env.BRUDAM_PORTO_WEB_USER,
    webPass: process.env.BRUDAM_PORTO_WEB_PASS
  },
  ptx: {
    web:     'https://ptxtransporte.brudam.com.br',
    webUser: process.env.BRUDAM_PTX_WEB_USER,
    webPass: process.env.BRUDAM_PTX_WEB_PASS
  },
  pex: {
    web:     'https://pexlogistica.brudam.com.br',
    webUser: process.env.BRUDAM_PEX_WEB_USER,
    webPass: process.env.BRUDAM_PEX_WEB_PASS
  }
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const base = req.query.base || 'porto';
  const b = BASES[base];
  if (!b) return res.status(400).json({ error: 'Base inválida' });

  const result = {
    base,
    webUserPresente: !!b.webUser,
    webPassPresente: !!b.webPass,
    csrfFound:    false,
    pageSize:     0,
    loginStatus:  false,
    uidbrdObtido: false,
    step:         'inicio',
    erro:         null,
    loginResposta: null
  };

  try {
    result.step = 'buscando-pagina';
    const pageResp = await fetch(`${b.web}/`, { redirect: 'follow', headers: { 'User-Agent': UA } });
    const pageHtml = await pageResp.text();
    result.pageSize = pageHtml.length;
    result.step = 'pagina-obtida';

    const tokenMatch = pageHtml.match(/name="token"[^>]*value="([^"]+)"/);
    result.csrfFound = !!tokenMatch;
    if (!tokenMatch) {
      result.step = 'csrf-nao-encontrado';
      result.paginaInicio = pageHtml.substring(0, 300);
      return res.status(200).json(result);
    }

    result.step = 'fazendo-login';
    const pageCookies = pageResp.headers.get('set-cookie') || '';
    const loginHeaders = { 'Content-Type': 'application/json', 'User-Agent': UA };
    if (pageCookies) loginHeaders['Cookie'] = pageCookies;

    const loginResp = await fetch(`${b.web}/brd/sys/login/tms`, {
      method: 'POST',
      headers: loginHeaders,
      body: JSON.stringify({ user: b.webUser, password: b.webPass, token: tokenMatch[1] })
    });
    const loginData = await loginResp.json().catch(() => ({}));
    result.loginResposta = { status: loginData.status, message: loginData.message };
    result.loginStatus = !!loginData.status;

    if (!loginData.status) {
      result.step = 'login-falhou';
      return res.status(200).json(result);
    }

    const uidbrd = loginData.data?.udata?.uidbrd;
    result.uidbrdObtido = !!uidbrd;
    result.step = uidbrd ? 'ok' : 'uidbrd-nao-encontrado';
  } catch (e) {
    result.step = 'excecao';
    result.erro = e.message;
  }

  return res.status(200).json(result);
}
