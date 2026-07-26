const BASES = {
  porto: { url: 'https://azportoex.brudam.com.br/api/v1', usuario: '80f260dcd0a7764a0e1b32e4c6595730', senha: '74bd7c5a2b5c62de4e333264dd69e2a46f4b7f4e3ebfb4adf91ad56972622d63' },
  ptx:   { url: 'https://ptxtransporte.brudam.com.br/api/v1', usuario: 'b45831041f9926f61af06e982cd70e63', senha: '55f13643587f0f9762df795d7cd1f81ef13faec2f789abac62fb77f7a3df1537' },
  pex:   { url: 'https://pexlogistica.brudam.com.br/api/v1', usuario: '19657d11bf9e3384271a8e455631ee4e', senha: '7546b7457a2c0f2efb39524eb00fa5e858f3b4d8b03ecbf182687e8b4a93a5ba' }
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

async function login(url, usuario, senha) {
  const r = await fetch(`${url}/acesso/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, senha })
  });
  const j = await r.json();
  if (!j.data?.access_key) throw new Error(j.message || j.error || 'Falha no login');
  return j.data.access_key;
}

// Testa uma variante específica de auth para saidaEfetiva
async function trySaidaVariant(baseUrl, token, idMan, kmInicial, dataSaida, authBody) {
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
  const payload = { idMan: Number(idMan), kmInicial: Number(kmInicial), dataSaida };
  if (authBody !== undefined) payload.auth = authBody;

  const r = await fetch(`${baseUrl}/operacional/alteracao/manifesto/saidaEfetiva`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  const text = await r.text();
  let j = {};
  try { j = JSON.parse(text); } catch {}
  const msg = j.data?.message || j.message || j.error || text.slice(0, 200);
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

  const allAttempts = [];

  try {
    for (const baseKey of baseOrder) {
      const b = BASES[baseKey];
      let token;
      try {
        token = await login(b.url, b.usuario, b.senha);
      } catch (e) {
        allAttempts.push({ base: baseKey, loginError: e.message });
        continue;
      }

      // Variantes de auth a testar em ordem
      const authVariants = [
        { label: 'sistema_hash',   body: { usuario: b.usuario, senha: b.senha } },
        { label: 'sem_auth',       body: undefined },
        { label: 'MCM_plain',      body: { usuario: 'MCM', senha: 'Portoex18' } },
        { label: 'mcm_lower',      body: { usuario: 'mcm', senha: 'Portoex18' } },
        { label: 'mcm_md5_sha256', body: { usuario: '5b843ed5160086c2d34710c0ef6a1da6', senha: 'ecf6387852f87cb5b2327b541fb7c933e2dd42d17d34e9947a0ad2cedefc42cb' } },
      ];

      for (const variant of authVariants) {
        const result = await trySaidaVariant(b.url, token, idMan, kmInicial, dataSaidaBrudam, variant.body);
        allAttempts.push({ base: baseKey, auth: variant.label, ok: result.ok, status: result.status, msg: result.msg });

        if (result.ok) {
          // SUCESSO — envia foto
          const rFoto = await fetch(`${b.url}/tracking/ocorrencias`, {
            method: 'POST',
            headers: result.headers,
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
            authUsada: variant.label
          });
        }

        // Se a mensagem mudou (não é mais "unidade/token"), parar nas variantes —
        // é um erro diferente (ex: data inválida, manifesto não encontrado)
        const msg = result.msg.toLowerCase();
        if (!msg.includes('unidade') && !msg.includes('token') && !msg.includes('nao encontrado') && !msg.includes('não encontrado')) {
          break; // Esse base+auth chegou mais longe; erros restantes são de outro tipo
        }
      }
    }

    // Nenhuma combinação funcionou ℔ retorna diagnóstico completo
    return res.status(400).json({
      error: 'Saida nao registrada. Veja attempts para diagnostico.',
      dataSaidaEnviada: dataSaidaBrudam,
      attempts: allAttempts
    });

  } catch (e) {
    return res.status(500).json({ error: e.message, attempts: allAttempts });
  }
}
