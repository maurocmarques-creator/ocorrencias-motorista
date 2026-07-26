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

// Obtém sessão PHP do Brudam web (para salvar no ANEXO do manifesto)
async function getWebSession(base) {
  if (!base.webUser || !base.webPass) return null;
  try {
    // 1) Buscar CSRF token da página de login
    const pageResp = await fetch(`${base.web}/`, { redirect: 'follow' });
    const pageHtml = await pageResp.text();
    const tokenMatch = pageHtml.match(/name="token"[^>]*value="([^"]+)"/);
    const csrfToken = tokenMatch?.[1];
    if (!csrfToken) return null;
    // Capturar cookie de pré-sessão
    const setCookie = pageResp.headers.get('set-cookie') || '';
    const preSession = setCookie.match(/PHPSESSID=([^;]+)/)?.[1] || '';

    // 2) Fazer login com credenciais web
    const loginResp = await fetch(`${base.web}/brd/sys/login/tms`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(preSession ? { 'Cookie': `PHPSESSID=${preSession}` } : {})
      },
      body: JSON.stringify({ user: base.webUser, password: base.webPass, token: csrfToken })
    });
    const loginData = await loginResp.json().catch(() => ({}));
    if (!loginData.status) return null;

    // Extrair sessão autenticada do header Set-Cookie
    const loginCookie = loginResp.headers.get('set-cookie') || '';
    const session = loginCookie.match(/PHPSESSID=([^;]+)/)?.[1] || preSession;
    return session || null;
  } catch (_) { return null; }
}

// Salva foto no ANEXO do manifesto via PHP (2 etapas: S3 + gravaAnexo.php)
async function uploadAnexo(base, bearerToken, phpsessid, idMan, fotoDados, fotoNome) {
  // Etapa 1: Upload para S3 via endpoint autenticado por Bearer
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
  if (!s3Data.status) throw new Error('Upload S3 falhou: ' + s3Data.message);
  const s3Url = s3Data.data?.[0];
  if (!s3Url) throw new Error('URL S3 não retornada');

  // Etapa 2: Associar arquivo ao manifesto via gravaAnexo.php (sessão PHP)
  const boundary = `----Boundary${Date.now()}`;
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="anexo"\r\n\r\n${s3Url}\r\n--${boundary}\r\nContent-Disposition: form-data; name="manifesto"\r\n\r\n${idMan}\r\n--${boundary}--`;
  const attachResp = await fetch(`${base.web}/operacional/ajax/gravaAnexo.php`, {
    method:  'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Cookie':       `PHPSESSID=${phpsessid}`
    },
    body
  });
  const attachData = await attachResp.json();
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
    const headers = {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`
    };
    const fotoNomeReal = fotoNome || `hodometro_saida_${idMan}.jpg`;

    // 1) Registrar saída efetiva
    const rSaida = await fetch(`${b.url}/operacional/alteracao/manifesto/saidaEfetiva`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        idMan:      Number(idMan),
        kmInicial:  Number(kmInicial),
        dataSaida:  dataSaida
      })
    });
    const jSaida = await rSaida.json().catch(() => ({}));
    if (!rSaida.ok) {
      return res.status(rSaida.status).json({
        error:  jSaida.message || jSaida.error || 'Erro ao registrar saída.',
        detail: jSaida
      });
    }

    // 2) Tentar salvar foto no ANEXO via sessão PHP
    let jAnexo = null;
    const phpsessid = await getWebSession(b);
    if (phpsessid) {
      try {
        jAnexo = await uploadAnexo(b, token, phpsessid, idMan, fotoDados, fotoNomeReal);
      } catch (e) {
        jAnexo = { error: e.message };
      }
    }

    // 3) Sempre salvar foto no tracking/ocorrências (registro de evento)
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
          eventos: [{
            codigo: 1,
            data:   dataSaida,
            obs:    `Hodômetro saída — KM ${kmInicial}`
          }],
          anexos: [{ arquivo: { nome: fotoNomeReal, dados: fotoDados } }]
        }]
      })
    });
    const jFoto = await rFoto.json();

    return res.status(200).json({
      saida:  { ok: true, data: jSaida },
      foto:   jFoto,
      anexo:  jAnexo
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
