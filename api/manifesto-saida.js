const BASES = {
  porto: {
    url:     'https://azportoex.brudam.com.br/api/v1',
    web:     'https://azportoex.brudam.com.br',
    usuario: '80f260dcd0a7764a0e1b32e4c6595730',
    senha:   '74bd7c5a2b5c62de4e333264dd69e2a46f4b7f4e3ebfb4adf91ad56972622d63',
    tokens:  ['1308e5c7e08678a69977454eee14598a0e0c6b16b094d9b4df', '07e0ee0a7b679edad721e952ae940c8aad72cb8f8cb26c2088'],
    webUser: process.env.BRUDAM_PORTO_WEB_USER,
    webPass: process.env.BRUDAM_PORTO_WEB_PASS
  },
  ptx: {
    url:     'https://ptxtransporte.brudam.com.br/api/v1',
    web:     'https://ptxtransporte.brudam.com.br',
    usuario: 'b45831041f9926f61af06e982cd70e63',
    senha:   '55f13643587f0f9762df795d7cd1f81ef13faec2f789abac62fb77f7a3df1537',
    tokens:  ['76ab1df4a1ccad39a60280122522032ff4d1872a06b4f5e9ca'],
    webUser: process.env.BRUDAM_PTX_WEB_USER,
    webPass: process.env.BRUDAM_PTX_WEB_PASS
  },
  pex: {
    url:     'https://pexlogistica.brudam.com.br/api/v1',
    web:     'https://pexlogistica.brudam.com.br',
    usuario: '19657d11bf9e3384271a8e455631ee4e',
    senha:   '7546b7457a2c0f2efb39524eb00fa5e858f3b4d8b03ecbf182687e8b4a93a5ba',
    tokens:  ['433959304b9584587a0427b6c605d33978f0a62572f37a2836'],
    webUser: process.env.BRUDAM_PEX_WEB_USER,
    webPass: process.env.BRUDAM_PEX_WEB_PASS
  }
};

async function login(base) {
  const r = await fetch(`${base.url}/acesso/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ usuario: base.usuario, senha: base.senha })
  });
  const j = await r.json();
  if (!j.data?.access_key) throw new Error('Falha no login: ' + j.message);
  return j.data.access_key;
}

async function getWebSession(base) {
  console.error('[WS] webUser presente:', !!base.webUser, '| webPass presente:', !!base.webPass);
  if (!base.webUser || !base.webPass)
    return { ok: false, reason: 'env-vars-missing' };
  try {
    const pageResp = await fetch(`${base.web}/`, { redirect: 'follow' });
    const pageCookies = pageResp.headers.get('set-cookie') || '';
    const pageHtml = await pageResp.text();
    const tokenMatch = pageHtml.match(/name="token"[^>]*value="([^"]+)"/);
    const csrfToken = tokenMatch?.[1];
    console.error('[WS] CSRF encontrado:', !!csrfToken);
    if (!csrfToken) return { ok: false, reason: 'csrf-not-found' };

    const loginHeaders = { 'Content-Type': 'application/json' };
    if (pageCookies) loginHeaders['Cookie'] = pageCookies;
    const loginResp = await fetch(`${base.web}/brd/sys/login/tms`, {
      method:  'POST',
      headers: loginHeaders,
      body: JSON.stringify({ user: base.webUser, password: base.webPass, token: csrfToken })
    });
    const loginData = await loginResp.json().catch(() => ({}));
    console.error('[WS] login status:', loginData.status, '| msg:', loginData.message);
    if (!loginData.status)
      return { ok: false, reason: 'login-failed', message: loginData.message };
    const uidbrd = loginData.data?.udata?.uidbrd;
    console.error('[WS] uidbrd obtido:', !!uidbrd);
    if (!uidbrd) return { ok: false, reason: 'uidbrd-not-found' };
    return { ok: true, uidbrd };
  } catch (e) {
    console.error('[WS] exception:', e.message);
    return { ok: false, reason: 'exception', message: e.message };
  }
}

async function uploadAnexo(base, bearerToken, phpsessid, idMan, fotoDados, fotoNome) {
  const s3Resp = await fetch(`${base.web}/brd/res/attachment/create`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bearerToken}` },
    body: JSON.stringify({
      files: [{
        name:       fotoNome,
        size:       Math.ceil(fotoDados.length * 0.75),
        type:       'image/jpeg',
        entityId:   Number(idMan),
        entityType: 11,
        attachType: 29,
        data:       fotoDados,
        agente:     false
      }]
    })
  });
  const s3Data = await s3Resp.json();
  console.error('[ANEXO] S3 status:', s3Data.status, '| msg:', s3Data.message);
  if (!s3Data.status) throw new Error('Upload S3 falhou: ' + s3Data.message);
  const s3Url = s3Data.data?.[0];
  if (!s3Url) throw new Error('URL S3 não retornada');

  const boundary = `----Boundary${Date.now()}`;
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="anexo"\r\n\r\n${s3Url}\r\n--${boundary}\r\nContent-Disposition: form-data; name="manifesto"\r\n\r\n${idMan}\r\n--${boundary}--`;
  const attachResp = await fetch(`${base.web}/operacional/ajax/gravaAnexo.php`, {
    method:  'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Cookie':       `uidbrd=${phpsessid}`
    },
    body
  });
  const attachData = await attachResp.json();
  console.error('[ANEXO] gravaAnexo status:', attachData.status, '| msg:', attachData.message);
  if (!attachData.status) throw new Error('gravaAnexo falhou: ' + attachData.message);
  return { s3Url, anexos: attachData.anexos };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const { base, idMan, kmInicial, dataSaida, fotoNome, fotoDados, cliente } = req.body || {};

  const b = BASES[base];
  if (!b)         return res.status(400).json({ error: 'Base inválida.' });
  if (!idMan)     return res.status(400).json({ error: 'idMan obrigatório.' });
  if (!kmInicial) return res.status(400).json({ error: 'kmInicial obrigatório.' });
  if (!dataSaida) return res.status(400).json({ error: 'dataSaida obrigatório.' });
  if (!fotoDados) return res.status(400).json({ error: 'Foto do hodômetro obrigatória.' });

  try {
    const token = await login(b);
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
    const fotoNomeReal = fotoNome || `hodometro_saida_${idMan}.jpg`;

    let rSaida, jSaida;
    for (const tok of b.tokens) {
      rSaida = await fetch(`${b.url}/operacional/alteracao/manifesto/saidaEfetiva`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
        body: JSON.stringify({ idMan: Number(idMan), kmInicial: Number(kmInicial), dataSaida })
      });
      jSaida = await rSaida.json().catch(() => ({}));
      if (rSaida.ok) break;
      const msg = (jSaida?.data?.message || jSaida?.message || '').toLowerCase();
      if (!msg.includes('unidade')) break;
    }
    if (!rSaida.ok) {
      return res.status(rSaida.status).json({
        error:  jSaida?.data?.message || jSaida?.message || jSaida?.error || 'Erro ao registrar saída.',
        detail: jSaida
      });
    }

    let jAnexo = null;
    const sessionResult = await getWebSession(b);
    console.error('[SAIDA] sessionResult:', JSON.stringify(sessionResult).substring(0, 120));
    if (!sessionResult.ok) {
      jAnexo = { error: `Sessão web não obtida: ${sessionResult.reason}`, detail: sessionResult.message };
    } else {
      try {
        jAnexo = await uploadAnexo(b, token, sessionResult.uidbrd, idMan, fotoDados, fotoNomeReal);
      } catch (e) {
        jAnexo = { error: e.message };
      }
    }
    console.error('[SAIDA] jAnexo:', JSON.stringify(jAnexo).substring(0, 200));

    const rFoto = await fetch(`${b.url}/tracking/ocorrencias`, {
      method:  'POST',
      headers,
      body: JSON.stringify({
        auth: { usuario: b.usuario, senha: b.senha },
        documentos: [{
          cliente:   cliente || '',
          tipo:      'MANIFESTO',
          tipo_op:   'MANIFESTO',
          manifesto: Number(idMan),
          eventos: [{ codigo: 1, data: dataSaida, obs: `Hodômetro saída — KM ${kmInicial}` }],
          anexos: [{ arquivo: { nome: fotoNomeReal, dados: fotoDados } }]
        }]
      })
    });
    const jFoto = await rFoto.json();

    return res.status(200).json({ saida: { ok: true, data: jSaida }, foto: jFoto, anexo: jAnexo });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}