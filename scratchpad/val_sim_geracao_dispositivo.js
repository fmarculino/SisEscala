// Valida o portao sim_geracao_dispositivo.js injetando regressoes de proposito
// (CLAUDE.md, armadilha 36: portao que nunca falha nao vale nada).
//
// Cada regressao abaixo e um defeito REAL - ou o que existia antes de 06/09/2026, ou o que a
// revisao desta mudanca quase deixou passar. O portao TEM de reprovar em todas.
//
// ⚠️ ARMADILHA 48: confirma que cada substituicao foi de fato APLICADA antes de rodar. Um
// replace no-op faria o portao "passar" e o teste do teste mentiria - pior que nao ter teste.
//
// Rodar:  node scratchpad/val_sim_geracao_dispositivo.js
'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const RAIZ = path.resolve(__dirname, '..')
const MIG = path.join(RAIZ, 'supabase', 'migrations')

function acharMig(prefixo) {
  const arq = fs.readdirSync(MIG).find((f) => f.startsWith(prefixo))
  if (!arq) throw new Error(`migration ${prefixo}* nao encontrada`)
  return path.join(MIG, arq)
}

const ALVOS = {
  ger: acharMig('20260906120000'),
  snap: acharMig('20260906130000'),
  fix: acharMig('20260906140000'),
  rota: path.join(RAIZ, 'src', 'app', 'api', 'rep', 'v1', 'usuarios-dispositivo', 'route.ts'),
  go: path.join(RAIZ, 'tools', 'coletor-rep', 'sisescala', 'client.go'),
}

// ⚠️ As migrations sao gravadas em CRLF (convencao do projeto). Comparar contra strings com
// \n nao casa NENHUMA substituicao multilinha - e o efeito e' justamente o no-op silencioso da
// armadilha 48. Por isso o casamento acontece sobre uma copia normalizada em LF, e a escrita
// devolve o final de linha original de cada arquivo.
const ORIGINAL = {}   // bytes exatos, para restaurar
const NORMAL = {}     // mesmo conteudo em LF, para casar
const CRLF = {}       // o arquivo era CRLF?
for (const [k, p] of Object.entries(ALVOS)) {
  const bruto = fs.readFileSync(p, 'utf8')
  ORIGINAL[k] = bruto
  CRLF[k] = bruto.includes('\r\n')
  NORMAL[k] = bruto.replace(/\r\n/g, '\n')
}
function gravar(alvo, textoLF) {
  fs.writeFileSync(ALVOS[alvo], CRLF[alvo] ? textoLF.replace(/\n/g, '\r\n') : textoLF)
}
function restaurar() { for (const [k, p] of Object.entries(ALVOS)) fs.writeFileSync(p, ORIGINAL[k]) }

function portaoPassa() {
  try { execFileSync(process.execPath, [path.join(__dirname, 'sim_geracao_dispositivo.js')], { stdio: 'pipe' }); return true }
  catch { return false }
}

const REGRESSOES = [
  {
    nome: 'ON CONFLICT volta a ignorar a geracao (o descarte silencioso do CCE)',
    alvo: 'ger',
    de: 'ON CONFLICT (dispositivo_id, geracao, nsr) DO NOTHING',
    para: 'ON CONFLICT (dispositivo_id, nsr) DO NOTHING',
  },
  {
    nome: 'a cadeia de hash volta a atravessar equipamentos',
    alvo: 'ger',
    de: '       AND geracao = v_geracao\n     ORDER BY nsr DESC LIMIT 1;',
    para: '     ORDER BY nsr DESC LIMIT 1;',
  },
  {
    nome: 'o cursor volta a contar o AFD do equipamento anterior',
    alvo: 'ger',
    de: '                   AND r.geracao = (SELECT d.geracao_atual',
    para: '                   AND (true OR 1 = (SELECT d.geracao_atual',
  },
  {
    nome: 'a constraint antiga fica no lugar (duas chaves conflitantes)',
    alvo: 'ger',
    de: 'ALTER TABLE public.rep_afd_registros\n    DROP CONSTRAINT IF EXISTS uq_afd_dispositivo_nsr;',
    para: '-- (removido de proposito para o teste)',
  },
  {
    nome: 'a migration ganha um gatilho que troca a geracao sozinha',
    alvo: 'ger',
    de: '-- 7. fn_registrar_substituicao_dispositivo',
    para: '-- CREATE TRIGGER trg_auto_geracao ... (regressao)\n-- 7. fn_registrar_substituicao_dispositivo',
    // A asercao que pega isto e naoContem('CREATE TRIGGER'), entao basta a string aparecer.
    ajuste: (s) => s.replace('-- CREATE TRIGGER trg_auto_geracao', 'CREATE TRIGGER trg_auto_geracao'),
  },
  {
    nome: 'a rota vira otimista e assume leitura boa',
    alvo: 'rota',
    de: 'body?.leitura_ok === true',
    para: 'body?.leitura_ok ?? true',
  },
  {
    nome: 'a guarda dos 15 minutos some do snapshot',
    alvo: 'snap',
    de: "               AND v.created_at < now() - interval '15 minutes'\n",
    para: '',
  },
  {
    // O defeito REAL de 06/09: a coluna e' `bigint NOT NULL DEFAULT 0`, e NULL morre com 23502
    // na primeira execucao. plpgsql so descobre isso EXECUTANDO (armadilha 1).
    nome: 'ultimo_nsr volta a receber NULL numa coluna NOT NULL',
    alvo: 'fix',
    de: '           ultimo_nsr    = 0,',
    para: '           ultimo_nsr    = NULL,',
  },
  {
    nome: 'a correcao perde o guard de papel',
    alvo: 'fix',
    de: "IF v_papel IS NULL OR v_papel NOT IN ('super_admin', 'admin') THEN",
    para: 'IF false THEN',
  },
  {
    nome: 'o coletor afirma leitura boa por constante escondida',
    alvo: 'go',
    de: 'func (c *Client) ReportarUsuariosDispositivo(usuarios []UsuarioDispositivoRelato, leituraOK bool)',
    para: 'func (c *Client) ReportarUsuariosDispositivo(usuarios []UsuarioDispositivoRelato)',
  },
]

let reprovouTodas = true
console.log('Injetando regressoes de proposito. O portao TEM de reprovar em cada uma.\n')

try {
  if (!portaoPassa()) {
    console.log('  ABORTADO: o portao ja esta reprovando ANTES de qualquer injecao.')
    console.log('  Conserte o estado atual antes de validar o portao.')
    process.exit(1)
  }
  console.log('  (estado limpo: o portao passa)\n')

  for (const r of REGRESSOES) {
    const antes = NORMAL[r.alvo]
    let depois = antes.split(r.de).join(r.para)
    if (r.ajuste) depois = r.ajuste(depois)

    // ⚠️ Armadilha 48: se o texto nao mudou, a "regressao" nao existiu e um portao que passa
    // nao prova nada. Isso ja aconteceu neste projeto por diferenca de indentacao.
    if (depois === antes) {
      console.log(`  x  ${r.nome}\n     SUBSTITUICAO NAO APLICADA - o alvo mudou de forma. Corrija o validador.`)
      reprovouTodas = false
      continue
    }

    gravar(r.alvo, depois)
    const passou = portaoPassa()
    restaurar()

    if (passou) {
      console.log(`  FALHA  ${r.nome}\n         o portao PASSOU com a regressao aplicada.`)
      reprovouTodas = false
    } else {
      console.log(`  ok     ${r.nome} -> reprovado`)
    }
  }
} finally {
  restaurar()
}

// Prova final: depois de tudo restaurado, o portao volta a passar. Sem isto, um validador que
// deixasse lixo no repositorio passaria despercebido.
if (!portaoPassa()) {
  console.log('\n  FALHA: o portao nao voltou a passar depois de restaurar os arquivos.')
  process.exit(1)
}

console.log('\n' + (reprovouTodas
  ? `Todas as ${REGRESSOES.length} regressoes foram reprovadas pelo portao, e o estado foi restaurado.`
  : 'ALGUMA REGRESSAO PASSOU - o portao nao protege o que diz proteger.'))
process.exit(reprovouTodas ? 0 : 1)
