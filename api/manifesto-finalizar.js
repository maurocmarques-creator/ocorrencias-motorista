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

// Obtém sessão web do Brudam (token uidbrd) para salvar no ANEXO do manifesto
// Retorna { ok, uidbrd } ou { ok: false, reason, message }
async function getWebSession(base) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  if (!base.webUser || !base.webPass)
    return { ok: false, reason: 'env-vars-missing' };
  try {
    // 1) Buscar CSRF token da página de login (User-Agent obrigatório — Brudam serve HTML diferente sem ele)
    const pageResp = await fetch(`${base.web}/`, { redirect: 'follow', headers: { 'User-Agent': UA } });
    const pageCookies = pageResp.headers.get('set-cookie') || '';
    const pageHtml = await pageResp.text();
    const tokenMatch = pageHtml.match(/name="token"[^>]*value="([^"]+)"/);
    const csrfToken = tokenMatch?.[1];
    if (!csrfToken) return { ok: false, reason: 'csrf-not-found' };

    // 2) Fazer login — retorna uidbrd em data.udata.uidbrd
    const loginHeaders = { 'Content-Type': 'application/json' };
    if (pageCookies) loginHeaders['Cookie'] = pageCookies;
    const loginResp = await fetch(`${base.web}/brd/sys/login/tms`, {
      method:  'POST',
      headers: loginHeaders,
      body: JSON.stringify({ user: base.webUser, password: base.webPass, token: csrfToken })
    });
    const loginData = await loginResp.json().catch(() => ({}));
    if (!loginData.status)
      return { ok: false, reason: 'login-failed', message: loginData.message };
    const uidbrd = loginData.data?.udata?.uidbrd;
    if (!uidbrd) return { ok: false, reason: 'uidbrd-not-found' };
    return { ok: true, uidbrd };
  } catch (e) { return { ok: false, reason: 'exception', message: e.message }; }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Salva foto no ANEXO do manifesto via PHP (2 etapas: S3 + gravaAnexo.php)
async function uploadAnexo(base, bearerToken, phpsessid, idMan, fotoDados, fotoNome) {
  // Etapa 1: Upload para S3 — autenticado pela sessão web (uidbrd cookie)
  const s3Resp = await fetch(`${base.web}/brd/res/attachment/create`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${bearerToken}`,
      'Cookie':        `uidbrd=${phpsessid}`,
      'User-Agent':    UA
    },
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
      'User-Agent':   UA,
      'Cookie':       `uidbrd=${phpsessid}`
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

  const { base, idMan, kmFinal, dataChegada, fotoNome, fotoDados, cliente } = req.body || {};

  const b = BASES[base];
  if (!b)           return res.status(400).json({ error: 'Base inválida.' });
  if (!idMan)       return res.status(400).json({ error: 'idMan obrigatório.' });
  if (!kmFinal)     return res.status(400).json({ error: 'kmFinal obrigatório.' });
  if (!dataChegada) return res.status(400).json({ error: 'dataChegada obrigatório.' });
  if (!fotoDados)   return res.status(400).json({ error: 'Foto do hodômetro obrigatória.' });

  try {
    const token = await login(b);
    const headers = {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`
    };
    const fotoNomeReal = fotoNome || `hodometro_chegada_${idMan}.jpg`;

    // 0) Pre-check: minutas sem ocorrência
    try {
      const rMan = await fetch(`${b.url}/operacional/consulta/manifesto/${idMan}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (rMan.ok) {
        const jMan = await rMan.json();
        const d = jMan?.data || {};
        const docs = d.documentos || d.notas || d.notas_fiscais || d.ctes || d.romaneios || [];
        if (Array.isArray(docs) && docs.length > 0) {
          const semOcorrencia = docs.filter(doc => {
            const ev = doc.eventos || doc.historico || doc.ocorrencias || doc.tracking || [];
            return Array.isArray(ev) && ev.length === 0;
          });
          if (semOcorrencia.length > 0) {
            const nums = semOcorrencia
              .map(doc => doc.minuta || doc.documento || doc.numero || doc.cte || doc.id)
              .filter(Boolean);
            return res.status(422).json({
              error: `${semOcorrencia.length} minuta(s) sem ocorrência. Registre antes de finalizar.`,
              minutas_pendentes: nums
            });
          }
        }
      }
    } catch (_) { /* prosseguir se pre-check falhar */ }

    // 1) Tentar salvar foto no ANEXO via sessão PHP
    let jAnexo = null;
    const sessionResult = await getWebSession(b);
    if (!sessionResult.ok) {
      jAnexo = { error: `Sessão web não obtida: ${sessionResult.reason}`, detail: sessionResult.message };
    } else {
      try {
        jAnexo = await uploadAnexo(b, token, sessionResult.uidbrd, idMan, fotoDados, fotoNomeReal);
      } catch (e) {
        jAnexo = { error: e.message };
      }
    }

    // 2) Salvar foto no tracking/ocorrências (registro de evento)
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
            data:   dataChegada,
            obs:    `Hodômetro chegada — KM ${kmFinal}`
          }],
          anexos: [{ arquivo: { nome: fotoNomeReal, dados: fotoDados } }]
        }]
      })
    });
    const jFoto = await rFoto.json();

    // 3) Finalizar manifesto — tenta cada token estático até um funcionar
    let rFin, jFin;
    for (const tok of b.tokens) {
      rFin = await fetch(`${b.url}/operacional/alteracao/manifesto/finalizarManifesto`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
        body: JSON.stringify({ idMan: Number(idMan), kmFinal: Number(kmFinal), dataChegada })
      });
      jFin = await rFin.json().catch(() => ({}));
      if (rFin.ok) break;
      const msg = (jFin?.data?.message || jFin?.message || '').toLowerCase();
      if (!msg.includes('unidade')) break;
    }
    if (!rFin.ok) return res.status(rFin.status).json({
      error: jFin?.data?.message || jFin?.message || jFin?.error || 'Erro ao finalizar manifesto.',
      minutas_pendentes: jFin?.data?.documentos_pendentes || jFin?.data?.minutas || jFin?.data?.pendentes || [],
      detail: jFin
    });

    return res.status(200).json({
      finalizar: jFin,
      foto:      jFoto,
      anexo:     jAnexo
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
