// Imagem JPEG 1x1 pixel mínima para teste
const JPEG_1PX = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARC' +
  'AABAAEDASIAARE BAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgIFB/8QAIxAAAgIBBAMBAAAAAAAAAAAAAQIDBAURITFBUWH/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEB' +
  'AAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8Amu1FrKuHXV5J55FjiQcszHAA/WaVYr2qdOnXit14I1ihijXaqKBgAAdhiiiiv/9k=';

const BASES = {
  porto: {
    url:     'https://azportoex.brudam.com.br/api/v1',
    web:     'https://azportoex.brudam.com.br',
    usuario: '80f260dcd0a7764a0e1b32e4c6595730',
    senha:   '74bd7c5a2b5c62de4e333264dd69e2a46f4b7f4e3ebfb4adf91ad56972622d63',
    webUser: process.env.BRUDAM_PORTO_WEB_USER,
    webPass: process.env.BRUDAM_PORTO_WEB_PASS
  },
  ptx: {
    url:     'https://ptxtransporte.brudam.com.br/api/v1',
    web:     'https://ptxtransporte.brudam.com.br',
    usuario: 'b45831041f9926f61af06e982cd70e63',
    senha:   '55f13643587f0f9762df795d7cd1f81ef13faec2f789abac62fb77f7a3df1537',
    webUser: process.env.BRUDAM_PTX_WEB_USER,
    webPass: process.env.BRUDAM_PTX_WEB_PASS
  },
  pex: {
    url:     'https://pexlogistica.brudam.com.br/api/v1',
    web:     'https://pexlogistica.brudam.com.br',
    usuario: '19657d11bf9e3384271a8e455631ee4e',
    senha:   '7546b7457a2c0f2efb39524eb00fa5e858f3b4d8b03ecbf182687e8b4a93a5ba',
    webUser: process.env.BRUDAM_PEX_WEB_USER,
    webPass: process.env.BRUDAM_PEX_WEB_PASS
  }
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function loginApi(base) {
  const r = await fetch(`${base.url}/acesso/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: base.usuario, senha: base.senha })
  });
  const j = await r.json();
  return j.data?.access_key || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const baseKey = req.query.base || 'porto';
  const idMan   = req.query.idMan || null;  // opcional: testa ANEXO com manifesto real
  const b = BASES[baseKey];
  if (!b) return res.status(400).json({ error: 'Base inválida' });

  const result = {
    base: baseKey,
    sessao: { step: 'inicio', csrfFound: false, loginStatus: false, uidbrdObtido: false },
    s3:     null,
    gravaAnexo: null,
    erro: null
  };

  // ── 1. Sessão web (CSRF + login) ──────────────────────────────────────────
  try {
    const pageResp = await fetch(`${b.web}/`, { redirect: 'follow', headers: { 'User-Agent': UA } });
    const pageHtml = await pageResp.text();
    result.sessao.pageSize = pageHtml.length;
    const tokenMatch = pageHtml.match(/name="token"[^>]*value="([^"]+)"/);
    result.sessao.csrfFound = !!tokenMatch;
    if (!tokenMatch) {
      result.sessao.step = 'csrf-nao-encontrado';
      result.sessao.paginaInicio = pageHtml.substring(0, 200);
      return res.status(200).json(result);
    }

    const pageCookies = pageResp.headers.get('set-cookie') || '';
    const loginHeaders = { 'Content-Type': 'application/json', 'User-Agent': UA };
    if (pageCookies) loginHeaders['Cookie'] = pageCookies;

    const loginResp = await fetch(`${b.web}/brd/sys/login/tms`, {
      method: 'POST',
      headers: loginHeaders,
      body: JSON.stringify({ user: b.webUser, password: b.webPass, token: tokenMatch[1] })
    });
    const loginData = await loginResp.json().catch(() => ({}));
    result.sessao.loginStatus  = !!loginData.status;
    result.sessao.loginMsg     = loginData.message;
    result.sessao.uidbrdObtido = !!loginData.data?.udata?.uidbrd;
    const uidbrd               = loginData.data?.udata?.uidbrd;

    if (!uidbrd) {
      result.sessao.step = 'uidbrd-nao-encontrado';
      return res.status(200).json(result);
    }
    result.sessao.step = 'ok';

    // ── 2. Se idMan fornecido, testa upload S3 + gravaAnexo ────────────────
    if (idMan) {
      const bearerToken = await loginApi(b);
      if (!bearerToken) {
        result.s3 = { erro: 'login-api-falhou' };
        return res.status(200).json(result);
      }

      // Etapa S3
      try {
        const s3Resp = await fetch(`${b.web}/brd/res/attachment/create`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bearerToken}` },
          body: JSON.stringify({
            files: [{
              name:       'teste_anexo.jpg',
              size:       500,
              type:       'image/jpeg',
              entityId:   Number(idMan),
              entityType: 11,
              attachType: 29,
              data:       JPEG_1PX,
              agente:     false
            }]
          })
        });
        const s3Data = await s3Resp.json().catch(() => ({}));
        result.s3 = { status: s3Resp.status, ok: s3Data.status, message: s3Data.message, data: s3Data.data };

        // Etapa gravaAnexo (só se S3 ok)
        if (s3Data.status && s3Data.data?.[0]) {
          const s3Url    = s3Data.data[0];
          const boundary = `----Boundary${Date.now()}`;
          const body     = `--${boundary}\r\nContent-Disposition: form-data; name="anexo"\r\n\r\n${s3Url}\r\n--${boundary}\r\nContent-Disposition: form-data; name="manifesto"\r\n\r\n${idMan}\r\n--${boundary}--`;
          const gaResp   = await fetch(`${b.web}/operacional/ajax/gravaAnexo.php`, {
            method:  'POST',
            headers: {
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
              'Cookie':       `uidbrd=${uidbrd}`,
              'User-Agent':   UA
            },
            body
          });
          const gaData = await gaResp.json().catch(async () => ({ _raw: await gaResp.text().catch(() => '') }));
          result.gravaAnexo = { status: gaResp.status, data: gaData };
        }
      } catch (e) {
        result.s3 = { erro: e.message };
      }
    }

  } catch (e) {
    result.erro = e.message;
    result.sessao.step = 'excecao';
  }

  return res.status(200).json(result);
}
