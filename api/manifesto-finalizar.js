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

  const { base, idMan, kmFinal, dataChegada, fotoNome, fotoDados, cliente } = req.body || {};

  const b = BASES[base];
  if (!b)          return res.status(400).json({ error: 'Base inválida.' });
  if (!idMan)      return res.status(400).json({ error: 'idMan obrigatório.' });
  if (!kmFinal)    return res.status(400).json({ error: 'kmFinal obrigatório.' });
  if (!dataChegada) return res.status(400).json({ error: 'dataChegada obrigatório.' });
  if (!fotoDados)  return res.status(400).json({ error: 'Foto do hodômetro obrigatória.' });

  try {
    const token = await login(b);
    const headers = {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`
    };

    // 1) Enviar foto de chegada como ocorrência/anexo (antes de finalizar)
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
          anexos: [{
            arquivo: {
              nome:  fotoNome || `hodometro_chegada_${idMan}.jpg`,
              dados: fotoDados
            }
          }]
        }]
      })
    });
    const jFoto = await rFoto.json();

    // 2) Finalizar manifesto (MDFe encerramento automático)
    const rFin = await fetch(`${b.url}/operacional/alteracao/manifesto/finalizarManifesto`, {
      method:  'POST',
      headers,
      body: JSON.stringify({
        idMan:       Number(idMan),
        kmFinal:     Number(kmFinal),
        dataChegada
      })
    });
    const jFin = await rFin.json();
    if (!rFin.ok) return res.status(rFin.status).json({ error: jFin.message || 'Erro ao finalizar manifesto.', detail: jFin });

    return res.status(200).json({
      finalizar: jFin,
      foto:      jFoto
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
