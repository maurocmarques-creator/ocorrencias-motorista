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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo nao permitido.' });

  const { base, idMan, kmInicial, dataSaida, fotoNome, fotoDados, cliente } = req.body || {};

  const b = BASES[base];
  if (!b) return res.status(400).json({ error: 'Base invalida.' });
  if (!idMan) return res.status(400).json({ error: 'idMan obrigatorio.' });
  if (!kmInicial) return res.status(400).json({ error: 'kmInicial obrigatorio.' });
  if (!fotoDados) return res.status(400).json({ error: 'Foto do hodometro obrigatoria.' });

  try {
    const token = await login(b.url, b.usuario, b.senha);
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
    const dataSaidaBrudam = isoToBrudam(dataSaida) || nowBrudam();

    const rSaida = await fetch(`${b.url}/operacional/alteracao/manifesto/saidaEfetiva`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        auth: { usuario: b.usuario, senha: b.senha },
        idMan: Number(idMan),
        kmInicial: Number(kmInicial),
        dataSaida: dataSaidaBrudam
      })
    });

    let jSaida = {};
    const saidaText = await rSaida.text();
    try { jSaida = JSON.parse(saidaText); } catch {}

    if (!rSaida.ok) {
      const errMsg = jSaida.data?.message || jSaida.message || jSaida.error || 'Erro ao registrar saida.';
      return res.status(rSaida.status).json({
        error: errMsg,
        detail: jSaida,
        debug: { idMan: Number(idMan), kmInicial: Number(kmInicial), dataSaidaEnviada: dataSaidaBrudam, base }
      });
    }

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
      saida: { ok: true, data: jSaida },
      foto: jFoto,
      timestamp: dataSaidaBrudam
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
