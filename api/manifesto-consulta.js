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

  const { base, id } = req.query;
  const b = BASES[base];
  if (!b)  return res.status(400).json({ error: 'Base invÃ¡lida. Use: porto, ptx ou pex.' });
  if (!id) return res.status(400).json({ error: 'ParÃ¢metro "id" obrigatÃ³rio.' });

  try {
    const token = await login(b);
    const headers = { Authorization: `Bearer ${token}` };

    // Tenta diferentes formatos de endpoint do Brudam
    const urls = [
      `${b.url}/operacional/consulta/manifesto/${id}`,
      `${b.url}/operacional/consulta/manifesto?manifesto=${id}`,
      `${b.url}/operacional/consulta/manifesto?id=${id}`,
    ];

    let lastStatus = 500;
    let lastBody   = {};

    for (const url of urls) {
      try {
        const r = await fetch(url, { headers });
        let j;
        try { j = await r.json(); } catch (_) { j = {}; }

        // Se retornou dados vÃ¡lidos, responde com sucesso
        if (r.ok && j && (j.data !== undefined || j.manifesto !== undefined || j.id !== undefined)) {
          return res.status(200).json(j.data !== undefined ? j : { data: j });
        }

        // Guarda a Ãºltima resposta para debug
        if (r.status !== 404) { lastStatus = r.status; lastBody = j; }
      } catch (_) {}
    }

    // Nenhum endpoint funcionou â retorna o que o Brudam disse + flag para o front pular a consulta
    return res.status(422).json({
      error: lastBody?.message || lastBody?.error || 'Manifesto nÃ£o encontrado no Brudam.',
      skip_consulta: true,
      _debug: lastBody
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
