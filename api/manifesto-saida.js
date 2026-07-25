const BASES = {
  porto: {
    url:     'https://azportoex.brudam.com.br/api/v1',
    usuario: '80f260dcd0a7764a0e1b32e4c6595730',
    senha:   '74bd7c5a2b5c62de4e333264dd69e2a46f4b7f4e3ebfb4adf91ad56972622d63'
  },
  ptx: {
    url:     'https://ptxtransporte.brudam.com.br/api/v1',
    usuario: 'b45831041f9926f61af06e982cd70e63',
    senha:   '55f13643587f0f9762df795d7cd1f81ef13faec2f789abac62fb77f7a3df1537'
  },
  pex: {
    url:     'https://pexlogistica.brudam.com.br/api/v1',
    usuario: '19657d11bf9e3384271a8e455631ee4e',
    senha:   '7546b7457a2c0f2efb39524eb00fa5e858f3b4d8b03ecbf182687e8b4a93a5ba'
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

    // 1) Registrar saída efetiva
    // Brudam limita 3 req/s — aguarda 450ms entre tentativas
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const authBody = { usuario: b.usuario, senha: b.senha };

    // Tenta snake_case com auth (mais provável), depois sem auth, depois camelCase
    const payloads = [
      { auth: authBody, id_manifesto: Number(idMan), km_inicial: Number(kmInicial), data_saida: dataSaida },
      { id_manifesto: Number(idMan), km_inicial: Number(kmInicial), data_saida: dataSaida },
      { auth: authBody, idMan: Number(idMan), kmInicial: Number(kmInicial), dataSaida },
    ];

    let rSaida, jSaida;
    const tentativas = [];

    for (let i = 0; i < payloads.length; i++) {
      if (i > 0) await sleep(450); // respeita rate limit de 3 req/s
      rSaida = await fetch(`${b.url}/operacional/alteracao/manifesto/saidaEfetiva`, {
        method: 'POST', headers, body: JSON.stringify(payloads[i])
      });
      jSaida = await rSaida.json().catch(() => ({}));
      tentativas.push({ keys: Object.keys(payloads[i]), status: rSaida.status, msg: jSaida.message || jSaida.error });
      if (rSaida.ok) break;
      const msg = (jSaida.message || jSaida.error || '').toLowerCase();
      if (!msg.includes('dados') && !msg.includes('campo') && !msg.includes('obrigat') && !msg.includes('requisições')) break;
    }

    if (!rSaida.ok) return res.status(rSaida.status).json({
      error:      jSaida.message || jSaida.error || 'Erro ao registrar saída.',
      detail:     jSaida,
      tentativas
    });

    // 2) Enviar foto como ocorrência/anexo
    const rFoto = await fetch(`${b.url}/tracking/ocorrencias`, {
      method:  'POST',
      headers,
      body: JSON.stringify({
        auth: { usuario: b.usuario, senha: b.senha },
        documentos: [{
          cliente:  cliente || '',
          tipo:     'MANIFESTO',
          tipo_op:  'MANIFESTO',
          manifesto: Number(idMan),
          eventos: [{
            codigo: 1,
            data:   dataSaida,
            obs:    `Hodômetro saída — KM ${kmInicial}`
          }],
          anexos: [{
            arquivo: {
              nome:  fotoNome || `hodometro_saida_${idMan}.jpg`,
              dados: fotoDados
            }
          }]
        }]
      })
    });
    const jFoto = await rFoto.json();

    return res.status(200).json({
      saida: jSaida,
      foto:  jFoto
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
