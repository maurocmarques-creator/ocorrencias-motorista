import { createHash } from 'crypto';

const BASES = {
  porto: { url: 'https://azportoex.brudam.com.br/api/v1', usuario: '80f260dcd0a7764a0e1b32e4c6595730', senha: '74bd7c5a2b5c62de4e333264dd69e2a46f4b7f4e3ebfb4adf91ad56972622d63' },
  ptx:   { url: 'https://ptxtransporte.brudam.com.br/api/v1', usuario: 'b45831041f9926f61af06e982cd70e63', senha: '55f13643587f0f9762df795d7cd1f81ef13faec2f789abac62fb77f7a3df1537' },
  pex:   { url: 'https://pexlogistica.brudam.com.br/api/v1', usuario: '19657d11bf9e3384271a8e455631ee4e', senha: '7546b7457a2c0f2efb39524eb00fa5e858f3b4d8b03ecbf182687e8b4a93a5ba' }
};

function sha256(str) {
  return createHash('sha256').update(str).digest('hex');
}

function md5(str) {
  return createHash('md5').update(str).digest('hex');
}

// Timestamp do servidor no formato Brudam: "DD/MM/YYYY HH:MM:SS"
function nowBrudam() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

  const { base, idMan, kmInicial, fotoNome, fotoDados, cliente, brudamUsuario, brudamSenha } = req.body || {};

  const b = BASES[base];
  if (!b) return res.status(400).json({ error: 'Base invalida.' });
  if (!idMan) return res.status(400).json({ error: 'idMan obrigatorio.' });
  if (!kmInicial) return res.status(400).json({ error: 'kmInicial obrigatorio.' });
  if (!fotoDados) return res.status(400).json({ error: 'Foto do hodometro obrigatoria.' });
  if (!brudamUsuario || !brudamSenha) return res.status(400).json({ error: 'Usuario e senha Brudam obrigatorios.' });

  try {
    const senhaSha256 = sha256(brudamSenha);
    const usuarioMd5  = md5(brudamUsuario.trim().toUpperCase());

    let personalToken = null;
    let loginMethod   = '';
    const loginAttempts = [
      { u: brudamUsuario, s: senhaSha256,        label: 'plain-usuario+sha256-senha' },
      { u: usuarioMd5,    s: senhaSha256,         label: 'md5-usuario+sha256-senha'   },
      { u: brudamUsuario, s: brudamSenha,         label: 'plain-usuario+plain-senha'  },
    ];

    for (const attempt of loginAttempts) {
      try {
        personalToken = await login(b.url, attempt.u, attempt.s);
        loginMethod   = attempt.label;
        break;
      } catch (_) {
        await sleep(400); // respeita limite de 3 req/s do Brudam
      }
    }

    await sleep(400);
    const systemToken = await login(b.url, b.usuario, b.senha);
    const token       = personalToken || systemToken;

    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

    const authBody = personalToken
      ? { usuario: loginAttempts.find(a => a.label === loginMethod).u,
          senha:   loginAttempts.find(a => a.label === loginMethod).s }
      : { usuario: b.usuario, senha: b.senha };

    const dataSaidaBrudam = nowBrudam();
    const saidaPayload = { auth: authBody, idMan: Number(idMan), kmInicial: Number(kmInicial), dataSaida: dataSaidaBrudam };

    const rSaida = await fetch(`${b.url}/operacional/alteracao/manifesto/saidaEfetiva`, {
      method: 'POST',
      headers,
      body: JSON.stringify(saidaPayload)
    });

    let jSaida = {};
    const saidaText = await rSaida.text();
    try { jSaida = JSON.parse(saidaText); } catch {}

    if (!rSaida.ok) {
      return res.status(rSaida.status).json({
        error:        jSaida.message || jSaida.error || 'Erro ao registrar saida.',
        detail:       jSaida,
        debug: {
          loginMethod,
          personalLoginOk: !!personalToken,
          saidaStatus: rSaida.status,
          saidaBody:   saidaText.slice(0, 500)
        }
      });
    }

    const rFoto = await fetch(`${b.url}/tracking/ocorrencias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${systemToken}` },
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
      saida:      { ok: true, data: jSaida },
      foto:       jFoto,
      timestamp:  dataSaidaBrudam,
      loginMethod
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
