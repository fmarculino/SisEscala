// Portao da geracao de equipamento (06/09/2026).
//
// Nao ha framework de teste neste projeto; o padrao e um simulador que aborta. Este cobre as
// DUAS metades do problema, e as duas importam por motivos diferentes:
//
//   PARTE A - o SQL REALMENTE GERADO. Le supabase/migrations/20260906120000_*.sql e
//   20260906130000_*.sql e afirma os invariantes sobre o artefato que vai ao banco. E' o que
//   pega alguem regerando de uma fonte errada, ou editando o arquivo a mao (armadilha 1).
//
//   PARTE B - o ALGORITMO do cursor. fn_cursor_afd_dispositivo devolve o fim do primeiro trecho
//   contiguo, e a mudanca foi escopa-lo a geracao vigente. Essa parte e sutil o bastante para
//   merecer simulacao propria: e' ela que faz o relogio novo voltar a pedir do NSR 1.
//
// Rodar:  node scratchpad/sim_geracao_dispositivo.js
'use strict'
const fs = require('fs')
const path = require('path')

const RAIZ = path.resolve(__dirname, '..')
const MIG = path.join(RAIZ, 'supabase', 'migrations')

let total = 0
let falhas = 0
function ok(nome, achado, esperado) {
  total++
  const a = JSON.stringify(achado)
  const e = JSON.stringify(esperado)
  if (a === e) { console.log(`  ok   ${nome}`) }
  else { falhas++; console.log(`  FALHA ${nome}\n        esperado: ${e}\n        achado:   ${a}`) }
}
function contem(nome, texto, agulha) { ok(nome, texto.includes(agulha), true) }
function naoContem(nome, texto, agulha) { ok(nome, texto.includes(agulha), false) }

function lerMig(prefixo) {
  const arq = fs.readdirSync(MIG).find((f) => f.startsWith(prefixo))
  if (!arq) { console.log(`  FALHA migration ${prefixo}* nao existe`); falhas++; total++; return '' }
  return fs.readFileSync(path.join(MIG, arq), 'utf8').replace(/\r\n/g, '\n')
}

const mGer = lerMig('20260906120000')
const mSnap = lerMig('20260906130000')

// ===========================================================================
// PARTE A1 - a unicidade passa a incluir a geracao, e a antiga SAI
// ===========================================================================
// Esta e a asercao central: enquanto a chave for (dispositivo_id, nsr), os NSR 1..N do relogio
// novo colidem com os do antigo e o ON CONFLICT ... DO NOTHING os descarta SEM ERRO NENHUM.
console.log('\nA1. unicidade por (dispositivo, geracao, nsr)')
contem('constraint nova do AFD criada', mGer,
  'ADD CONSTRAINT uq_afd_dispositivo_geracao_nsr UNIQUE (dispositivo_id, geracao, nsr)')
contem('constraint antiga do AFD derrubada', mGer,
  'DROP CONSTRAINT IF EXISTS uq_afd_dispositivo_nsr')
contem('indice novo de marcacoes criado', mGer,
  'ON public.marcacoes_ponto (dispositivo_id, geracao, nsr) WHERE origem = ')
contem('indice antigo de marcacoes derrubado', mGer,
  'DROP INDEX IF EXISTS public.uq_marcacao_rep_nsr;')
contem('ON CONFLICT passa a incluir a geracao', mGer,
  'ON CONFLICT (dispositivo_id, geracao, nsr) DO NOTHING')
// Se sobrar um ON CONFLICT antigo, o INSERT estoura em runtime (nao ha constraint com essas
// colunas depois desta migration) - e plpgsql so descobre isso EXECUTANDO (armadilha 1).
naoContem('nenhum ON CONFLICT antigo remanescente', mGer,
  'ON CONFLICT (dispositivo_id, nsr)')

// ===========================================================================
// PARTE A2 - as tres colunas, com DEFAULT que preserva o passado
// ===========================================================================
console.log('\nA2. colunas')
contem('dispositivos_rep.geracao_atual', mGer,
  'ADD COLUMN IF NOT EXISTS geracao_atual smallint NOT NULL DEFAULT 1')
contem('rep_afd_registros.geracao', mGer,
  'ADD COLUMN IF NOT EXISTS geracao smallint NOT NULL DEFAULT 1')
contem('marcacoes_ponto.geracao', mGer,
  'ADD COLUMN IF NOT EXISTS geracao smallint NOT NULL DEFAULT 1')

// ===========================================================================
// PARTE A3 - a cadeia de hash NAO pode atravessar equipamentos
// ===========================================================================
// Sem o filtro, o primeiro registro do relogio novo encadeia no ultimo do relogio velho, e a
// cadeia passa a afirmar uma continuidade que nunca existiu - num artefato que existe
// justamente para provar sequencia.
console.log('\nA3. cadeia de hash por geracao')
const trechoHash = mGer.slice(
  mGer.indexOf('SELECT hash_encadeado INTO v_hash_ant'),
  mGer.indexOf('SELECT hash_encadeado INTO v_hash_ant') + 260
)
contem('ultimo elo e buscado dentro da geracao', trechoHash, 'AND geracao = v_geracao')

// ===========================================================================
// PARTE A4 - o cursor conta dentro da geracao vigente
// ===========================================================================
console.log('\nA4. cursor por geracao')
const iCursor = mGer.indexOf('CREATE OR REPLACE FUNCTION public.fn_cursor_afd_dispositivo')
const fnCursor = mGer.slice(iCursor, mGer.indexOf('$fn$;', iCursor))
contem('filtra pela geracao vigente do dispositivo', fnCursor, 'AND r.geracao = (SELECT d.geracao_atual')
contem('mantem o calculo por trecho contiguo (LEAD)', fnCursor, 'LEAD(r.nsr) OVER (ORDER BY r.nsr)')
// O COALESCE para 1 e' o que faz geracao nova (zero registros) pedir o AFD inteiro. Sem ele a
// funcao devolveria NULL e o coletor nao saberia de onde comecar.
contem('sem registro na geracao, cai para 1', fnCursor, "1::bigint)")

// ===========================================================================
// PARTE A5 - a troca e' de uma PESSOA, e fica registrada
// ===========================================================================
console.log('\nA5. substituicao registrada, nunca automatica')
contem('funcao de substituicao existe', mGer,
  'CREATE OR REPLACE FUNCTION public.fn_registrar_substituicao_dispositivo')
contem('exige motivo', mGer, 'Informe o motivo da substituicao')
contem('so Administrador', mGer, "NOT IN ('super_admin', 'admin')")
contem('grava historico', mGer, 'INSERT INTO public.dispositivos_rep_substituicoes')
contem('trava o dispositivo enquanto decide', mGer, 'WHERE id = p_dispositivo_id FOR UPDATE')
contem('zera o ultimo_nsr denormalizado', mGer, 'ultimo_nsr    = NULL')
// A tabela de historico nao pode ter policy de escrita: seria um UPDATE que qualquer
// autenticado faz pelo PostgREST (armadilha 12).
naoContem('historico sem policy de INSERT', mGer,
  'ON public.dispositivos_rep_substituicoes FOR INSERT')
naoContem('historico sem policy FOR ALL', mGer,
  'ON public.dispositivos_rep_substituicoes FOR ALL')
// Nada no banco pode incrementar a geracao SOZINHO - detectar troca e' palpite (o relogio pode
// so ter tido a memoria lida errado num ciclo), e trocar por engano cria um AFD paralelo que
// ninguem pediu. O incremento pode existir em UM lugar so: dentro da RPC que uma pessoa chama.
naoContem('a migration nao cria gatilho nenhum', mGer, 'CREATE TRIGGER')
ok('geracao_atual so e incrementada em um unico ponto do arquivo',
  (mGer.match(/geracao_atual \+ 1/g) || []).length, 1)
ok('e esse ponto e a RPC de substituicao',
  mGer.indexOf('geracao_atual + 1')
    > mGer.indexOf('CREATE OR REPLACE FUNCTION public.fn_registrar_substituicao_dispositivo'),
  true)

// ===========================================================================
// PARTE A6 - o que a migration NAO pode fazer
// ===========================================================================
console.log('\nA6. o que nao pode acontecer')
// O AFD e' prova legal. Apagar historico do equipamento anterior para "limpar" a numeracao
// destruiria exatamente o que a Portaria 671/2021 exige preservar.
naoContem('nao apaga registro de AFD', mGer, 'DELETE FROM public.rep_afd_registros')
naoContem('nao apaga marcacao', mGer, 'DELETE FROM public.marcacoes_ponto')
// nsr continua sendo o que o equipamento disse. A alternativa (nsr_offset) foi descartada por
// falsificar um campo do artefato legal.
naoContem('nao reescreve o nsr gravado', mGer, 'SET nsr =')

// ===========================================================================
// PARTE A7 - snapshot: a guarda de lista vazia continua, com uma saida explicita
// ===========================================================================
console.log('\nA7. snapshot com leitura afirmada')
contem('guarda passa a aceitar leitura confiavel', mSnap, 'IF v_total > 0 OR p_leitura_ok THEN')
contem('parametro nasce com DEFAULT false', mSnap, 'p_leitura_ok     boolean DEFAULT false')
// Armadilha 41: assinatura nova e objeto NOVO, nasce aberta a PUBLIC; e duas sobrecargas fazem
// o PostgREST devolver PGRST203.
contem('assinatura antiga levou DROP', mSnap,
  'DROP FUNCTION IF EXISTS public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb);')
contem('REVOKE reescrito para a assinatura nova', mSnap,
  'REVOKE ALL ON FUNCTION public.fn_registrar_snapshot_usuarios_dispositivo(uuid, jsonb, boolean)')
// GUARDA 2 do original: vinculo criado ha menos de 15 min e' poupado. Ela protege a corrida
// entre ler o relogio paginado e publicar o snapshot, e vale TAMBEM com leitura vazia.
contem('guarda dos 15 minutos preservada', mSnap, "interval '15 minutes'")
// A comparacao por right(...,11) e' a armadilha 10: ltrim(...,'0') comeria um digito de CPF
// que comeca com zero - 37% da base.
contem('comparacao de identificador por right(...,11)', mSnap,
  "right(regexp_replace(u.identificador_afd, '\\D', '', 'g'), 11)")
naoContem('nunca usa ltrim de zeros no identificador', mSnap, "ltrim(u.identificador_afd, '0')")

// A rota so pode repassar `true` LITERAL. Campo ausente (coletor anterior a v0.16.0), string
// "true", 1 ou null tem que virar false - senao um corpo torto encerra vinculo de unidade
// inteira, que e muito pior que o bug do CCE.
console.log('\nA8. a rota nao pode ser otimista')
const rota = fs.readFileSync(
  path.join(RAIZ, 'src', 'app', 'api', 'rep', 'v1', 'usuarios-dispositivo', 'route.ts'), 'utf8')
contem('comparacao estrita com true', rota, 'body?.leitura_ok === true')
contem('repassa para a RPC', rota, 'p_leitura_ok: leituraOk')
naoContem('nunca Boolean(...) nem truthy', rota, 'Boolean(body?.leitura_ok)')
naoContem('nunca default true', rota, 'leitura_ok ?? true')

// O coletor tem que ser EXPLICITO. Uma constante escondida dentro do client faria um chamador
// futuro afirmar "leitura boa" sem ter lido nada.
const cliGo = fs.readFileSync(
  path.join(RAIZ, 'tools', 'coletor-rep', 'sisescala', 'client.go'), 'utf8')
contem('coletor recebe leituraOK por parametro', cliGo,
  'func (c *Client) ReportarUsuariosDispositivo(usuarios []UsuarioDispositivoRelato, leituraOK bool)')
contem('coletor envia o campo', cliGo, '"leitura_ok": leituraOK')

// ===========================================================================
// PARTE B - o ALGORITMO do cursor, simulado
// ===========================================================================
// Reproduz fn_cursor_afd_dispositivo: fim do primeiro trecho contiguo a partir do MENOR NSR
// da geracao vigente, mais 1; sem registro nenhum, 1.
function cursor(registros, geracaoAtual) {
  const nsrs = registros.filter((r) => r.geracao === geracaoAtual).map((r) => r.nsr).sort((a, b) => a - b)
  if (nsrs.length === 0) return 1
  for (let i = 0; i < nsrs.length; i++) {
    const prox = i + 1 < nsrs.length ? nsrs[i + 1] : null
    if (prox === null || prox !== nsrs[i] + 1) return nsrs[i] + 1
  }
  return nsrs[nsrs.length - 1] + 1
}

console.log('\nB. algoritmo do cursor')

// O caso do CCE, que motivou tudo: 111.508 registros contiguos do equipamento ANTIGO.
const cce = []
for (let n = 1; n <= 500; n++) cce.push({ geracao: 1, nsr: n })

ok('antes da troca, pede o proximo do equipamento atual', cursor(cce, 1), 501)
// 🚨 O DEFEITO: sem geracao, o cursor do relogio NOVO era o do antigo. get_afd.fcgi devolve
// nada, e a sincronizacao e gravada como "concluida" em todo ciclo. Sintoma: nenhum.
ok('depois da troca, o cursor volta a 1 sozinho', cursor(cce, 2), 1)

// O AFD do equipamento novo entra sem tocar no do antigo.
const depois = cce.concat([{ geracao: 2, nsr: 1 }, { geracao: 2, nsr: 2 }, { geracao: 2, nsr: 3 }])
ok('o equipamento novo avanca na propria numeracao', cursor(depois, 2), 4)
ok('a geracao anterior fica intacta e ainda contavel', cursor(depois, 1), 501)

// NSR repetido entre geracoes e LEGITIMO - os dois equipamentos emitiram o numero 1, e os dois
// sao verdadeiros. Com a chave antiga (dispositivo, nsr) o segundo era descartado em silencio.
const chaves = depois.map((r) => `${r.geracao}|${r.nsr}`)
ok('nenhuma colisao com a chave (geracao, nsr)', new Set(chaves).size, chaves.length)
const chavesAntigas = depois.map((r) => String(r.nsr))
ok('a chave antiga colidiria em 3 registros',
  chavesAntigas.length - new Set(chavesAntigas).size, 3)

// Recuperacao grande: a fila offline reenvia em ordem de nome de arquivo (hash), nao de NSR,
// entao o AFD fica com buracos transitorios. Cursor baixo durante recuperacao e CORRETO -
// nao confundir com cursor travado. Errar para baixo so reingere, que e de graca; errar para
// cima e a unica forma de perder marcacao.
const comLacuna = [1, 2, 3, 7, 8, 9].map((n) => ({ geracao: 2, nsr: n }))
ok('lacuna puxa o cursor de volta para antes dela', cursor(comLacuna, 2), 4)

// Piso acima de 1: o desenho trata "o menor NSR que existe" como piso, sem exigir que seja 1.
const pisoAlto = [3001, 3002, 3003].map((n) => ({ geracao: 2, nsr: n }))
ok('piso acima de 1 nao trava o cursor', cursor(pisoAlto, 2), 3004)

console.log(`\n${total - falhas}/${total} asercoes passaram.`)
if (falhas > 0) {
  console.log(`\n${falhas} FALHA(S).`)
  process.exit(1)
}
