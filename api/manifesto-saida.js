const BASES = {
  porto: {
    url: 'https://azportoex.brudam.com.br/api/v1',
    usuario: '80f260dcd0a7764a0e1b32e4c6595730',
    senha: '74bd7c5a2b5c62de4e333264dd69e2a46f4b7f4e3ebfb4adf91ad56972622d63'
  },
  ptx: {
    url: 'https://ptxtransporte.brudam.com.br/api/v1',
    usuario: 'b45831041f9926f61af06e982cd70e63',
    senha: '55f13643587f0f9762df795d7cd1f81ef13faec2f789abac62fb77f7a3df1537'
  },
  pex: {
    url: 'https://pexlogistica.brudam.com.br/api/v1',
    usuario: '19657d11bf9e3384271a8e455631ee4e',
    senha: '7546b7457a2c0f2efb39524eb00fa5e858f3b4d8b03ecbf182687e8b4a93a5ba'
  }
};

// Timestamp atual no formato Brudam: "DD/MM/YYYY HH:MM:SS" (exatamente 19 chars)
function nowBrudam() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

async function login(base) {
  const r = await fetch(`${base.url}/acesso/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: base.usuario, senha: base.senha })
  });
  const j = await r.json();
  if (!j.data?.access_key) throw new Error('Falha no login: ' + j.message);
  return j.data.access_key;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo nao permitido.' });

  const { base, idMan, kmInicial, fotoNome, fotoDados, cliente } = req.body || {};

  const b = BASES[base];
  if (!b) return res.status(400).json({ error: 'Base invalida.' });
  if (!idMan) return res.status(400).json({ error: 'idMan obrigatorio.' });
  if (!kmInicial) return res.status(400).json({ error: 'kmInicial obrigatorio.' });
  if (!fotoDados) return res.status(400).json({ error: 'Foto do hodometro obrigatoria.' });

  try {
    const token = await login(b);
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };

    const authBody = { usuario: b.usuario, senha: b.senha };

    // Usa o momento exato em que o motorista apertou o botao (timestamp do servidor)
    // Formato Brudam: "DD/MM/YYYY HH:MM:SS" (exatamente 19 chars)
    const dataSaidaBrudam = nowBrudam();

    // 1) Registrar saida efetiva - campos camelCase conforme API Brudam
    const rSaida = await fetch(`${b.url}/operacional/alteracao/manifesto/saidaEfetiva`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        auth:      authBody,
        idMan:     Number(idMan),
        kmInicial: Number(kmInicial),
        dataSaida: dataSaidaBrudam
      })
    });
    const jSaida = await rSaida.json().catch(() => ({}));

    if (!rSaida.ok) {
      return res.status(rSaida.status).json({
        error:  jSaida.message || jSaida.error || 'Erro ao registrar saida.',
        detail: jSaida
      });
    }

    const saidaStatus = { ok: true, data: jSaida };

    // 2) Enviar foto como ocorrencia/anexo
    const rFoto = await fetch(`${b.url}/tracking/ocorrencias`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        auth: authBody,
        documentos: [{
          cliente: cliente || '',
          tipo: 'MANIFESTO',
          tipo_op: 'MANIFESTO',
          manifesto: Number(idMan),
          eventos: [{
            codigo: 1,
            data: dataSaidaBrudam,
            obs: `Hodometro saida - KM ${kmInicial}`
          }],
          anexos: [{
            arquivo: {
              nome: fotoNome || `hodometro_saida_${idMan}.jpg`,
              dados: fotoDados
            }
          }]
        }]
      })
    });
    const jFoto = await rFoto.json();

    return res.status(200).json({
      saida:     saidaStatus,
      foto:      jFoto,
      timestamp: dataSaidaBrudam
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
