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

function agora() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Metodo nao permitido.' });

  const { base, minuta, cnpj, codigo, obs, foto_base64, foto_nome } = req.body || {};

  const b = BASES[base];
  if (!b)      return res.status(400).json({ error: 'Base invalida.' });
  if (!minuta) return res.status(400).json({ error: 'Numero da minuta obrigatorio.' });
  if (!codigo) return res.status(400).json({ error: 'Codigo da ocorrencia obrigatorio.' });

  try {
    const token = await login(b);

    const evento = {
      codigo: parseInt(codigo),
      data:   agora()
    };
    if (obs) evento.obs = obs;

    const documento = {
      tipo:   'MINUTA',
      minuta: parseInt(minuta),
      eventos: [evento]
    };

    if (cnpj) documento.cliente = cnpj;

    if (foto_base64 && foto_nome) {
      documento.anexos = [{
        arquivo: {
          nome:  foto_nome,
          dados: foto_base64
        }
      }];
    }

    const body = { documentos: [documento] };

    const r = await fetch(`${b.url}/tracking/ocorrencias`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    const j = await r.json();
    return res.status(r.status).json(j);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
