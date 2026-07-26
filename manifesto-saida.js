const BASES = {
  porto: {
    url:     'https://azportoex.brudam.com.br/api/v1',
    usuario: '80f260dcd0a7764a0e1b32e4c6595730',
    senha:   '74bd7c5a2b5c62de4e333264dd69e2a46f4b7f4e3ebfb4adf91ad56972622d63',
    // Tokens estáticos por unidade (não requerem login)
    tokens: [
      '1308e5c7e08678a69977454eee14598a0e0c6b16b094d9b4df', // MATRIZ
      '07e0ee0a7b679edad721e952ae940c8aad72cb8f8cb26c2088'  // FILIAL SP
    ]
  },
  ptx: {
    url:     'https://ptxtransporte.brudam.com.br/api/v1',
    usuario: 'b45831041f9926f61af06e982cd70e63',
    senha:   '55f13643587f0f9762df795d7cd1f81ef13faec2f789abac62fb77f7a3df1537'
  },
  pex: https://pexlogistica.brudam.com.br/api/v1',
    usuario: '19657d11bf9e3384271a8e455631ee4e',
    senha:   '7546b7457a2c0f2efb39524eb00fa5e858f3b4d8b03ecbf182687e8b4a93a5ba'
  }
};

function nowBrudam() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const pad = n => String(n).padStart(2, '0');
  return `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function isoToBrudam(s) {
  if (!s) return null;
  const [datePart, timePart] = s.split(' ');
  if (!datePart || !timePart) return null;
  const [y, m, d] = datePart.split('-');
  return `${d}/${m}/${y} ${timePart}`;
}

alogin(url, usuario, senha) {
  const r = await fetch(`${url}/acesso/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, senha })
  });
  const j = await r.json();
  if (!j.data?.access_key) throw new Error(j.message || j.error || 'Falha no login');
  return j.data.access_key;
}

async function trySaida(baseUrl, token, idMan, kmInicial, dataSaida) {
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
  const r = await fetch(`${baseUrl}/operacional/alteracao/manifesto/saidaEfetiva`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ idMan: Number(idMan), kmInicial: Number(kmInicial), dataSaida })
  });
  const j = await r.json().catch(() => ({}));
  const msg = j.data?.message || j.message || j.error || '';
  return { ok: r.ok, status: r.status, msg, json: j, headers };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo nao permitido.' });

  const { base, idMan, kmInicial, dataSaida, fotoNome, fotoDados, cliente } = req.body || {};

  if (!idMan)     return res.status(400).json({ error: 'idMan obrigatorio.' });
  if (!kmInicial) return res.status(400).json({ error: 'kmInicial obrigatorio.' });
  if (!fotoDados) return res.status(400).json({ error: 'Foto do hodometro obrigatoria.' });

  const dataSaidaBrudam = isoToBrudam(dataSaida) || nowBrudam();
  const baseOrder = base && BASES[base]
    ? [base, ...Object.keys(BASES).filter(k => k !== base)]
    : Object.keys(BASES);

  try {
    for (const baseKey of baseOrder) {
      const b = BASES[baseKey];

      // Monta lista de tokens a tentar: tokens estáticos (se houver) + login
      const tokenList = [];
      if (b.tokens?.length) {
        tokenList.push(...b.tokens.map(t => ({ token: t, source: 'static' })));
      }
      // Login como fallback
      try {
        const loginToken = await login(b.url, b.usuario, b.senha);
        tokenList.push({ token: loginToken, source: 'login' });
      } catch (_) {}

      for (const { token, source } of tokenList) {
        const result = await trySaida(b.url, token, idMan, kmInicial, dataSaidaBrudam);
        const msgLow = result.msg.toLowerCase();

        if (result.ok) {
          // Sucesso — envia foto do hodômetro
          const headers = result.headers;
          const rFoto = await fetch(`${b.url}/tracking/ocorrencias`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              auth: { usuario: b.usuario, senha: b.senha },
              documentos: [{
                cliente: cliente || '',
                tipo: 'MANIFESTO',
                tipo_op: 'MANIFESTO',
                manifesto: Number(idMan),
                eventos: [{ codigo: 1, data: dataSaidaBrudam, obs: `Hodometro saida - KM ${kmInicial}` }],
                anexos: [{ arquivo: { nome: fotoNome || `hodometro_saida_${idMan}.jpg`, dados: fotoDados } }]
              }]
            })
          });
          const jFoto = await rFoto.json().catch(() => ({}));
          return res.status(200).json({
            saida: { ok: true, data: result.json },
            foto: jFoto,
            timestamp: dataSaidaBrudam,
            baseUsada: baseKey,
            tokenSource: source
          });
        }

        // Manifesto nóo encontrado nesse token/base → tenta próximo
        if (msgLow.includes('nao encontrado') || msgLow.includes('não encontrado') ||
            msgLow.includes('unidade') || msgLow.includes('token')) {
          continue;
        }

        // Outro erro (KM inválido, status errado, etc.) — retorna sem tentar mais
        return res.status(400).json({
          error: result.msg || 'Erro ao registrar saida.',
          dataSaidaEnviada: dataSaidaBrudam,
          baseUsada: baseKey
        });
      }
    }

    return res.status(400).json({
      error: 'Manifesto nao encontrado em nenhuma base.',
      dataSaidaEnviada: dataSaidaBrudam
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
