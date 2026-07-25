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

// Converte "YYYY-MM-DDTHH:MM" para partes separadas no formato Brudam
function parseDatetime(dt) {
  if (!dt) return { date: '', time: '' };
  const clean = dt.replace('T', ' ');
  const [datePart = '', timePart = '00:00'] = clean.split(' ');
  const [y, m, d] = datePart.split('-');
  const time = timePart.length === 5 ? timePart + ':00' : timePart;
  return { date: `${d}/${m}/${y}`, time };
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const { base, idMan, kmInicial, dataSaida, fotoNome, fotoDados, cliente } = req.body || {};

  const b = BASES[base];
  if (!b) return res.status(400).json({ error: 'Base inválida.' });
  if (!idMan) return res.status(400).json({ error: 'idMan obrigatório.' });
  if (!kmInicial) return res.status(400).json({ error: 'kmInicial obrigatório.' });
  if (!dataSaida) return res.status(400).json({ error: 'dataSaida obrigatório.' });
  if (!fotoDados) return res.status(400).json({ error: 'Foto do hodômetro obrigatória.' });

  try {
    const token = await login(b);
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };

    const authBody = { usuario: b.usuario, senha: b.senha };

    // Separa data e hora no formato Brudam: DD/MM/YYYY e HH:MM:SS
    const { date: dataSaidaDate, time: dataSaidaTime } = parseDatetime(dataSaida);

    // 1) Registrar saída efetiva
    const saidaPayload = {
      auth:         authBody,
      id_manifesto: Number(idMan),
      km_inicial:   Number(kmInicial),
      data_saida:   dataSaidaDate,
      hora_saida:   dataSaidaTime
    };

    const rSaida = await fetch(`${b.url}/operacional/alteracao/manifesto/saidaEfetiva`, {
      method: 'POST',
      headers,
      body: JSON.stringify(saidaPayload)
    });
    const jSaida = await rSaida.json().catch(() => ({}));

    if (!rSaida.ok) {
      return res.status(rSaida.status).json({
        error:  jSaida.message || jSaida.error || 'Erro ao registrar saída.',
        detail: jSaida
      });
    }

    const saidaStatus = { ok: true, data: jSaida };

    // 2) Enviar foto como ocorrência/anexo
    const dataOcorrencia = `${dataSaidaDate} ${dataSaidaTime}`;
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
            data: dataOcorrencia,
            obs: `Hodômetro saída — KM ${kmInicial}`
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
      saida: saidaStatus,
      foto:  jFoto
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
