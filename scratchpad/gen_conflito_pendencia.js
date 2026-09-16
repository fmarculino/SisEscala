/**
 * Gera 20260916100000_conflito_de_pendencia_rh_fora_do_escopo.sql.
 *
 * Copia mecanica de fn_promover_pendencia_rh (CLAUDE.md armadilha 1) a partir da migration
 * VIGENTE, com duas substituicoes pontuais:
 *
 *   1. v_cpf_final passa a ser calculado logo depois de carregar a pendencia (antes era so na
 *      hora do INSERT) - so a atribuicao muda de lugar; os dois RAISE de obrigatoriedade ficam
 *      onde estao, para nenhuma ordem de mensagem mudar;
 *   2. a checagem de CPF ja cadastrado passa a olhar v_cpf_final (pendencia OU digitado na tela)
 *      em vez de so v_pend.cpf_normalizado - senao um CPF digitado que ja existe cria duplicata
 *      em silencio.
 *
 * Trabalha por LINHA, nunca por regex sobre o corpo: a linha da atribuicao contem um regexp do
 * Postgres com barra invertida, e qualquer escape a mais ou a menos transformaria a substituicao
 * em no-op mudo (armadilhas 48 e 59). Aborta se qualquer contagem divergir.
 */
const fs = require('fs')
const path = require('path')

const MIGR = path.join(__dirname, '..', 'supabase', 'migrations')
const FONTE = path.join(MIGR, '20260812110000_cpf_obrigatorio_e_conflito_matricula_pendencia_rh.sql')
const DESTINO = path.join(MIGR, '20260916100000_conflito_de_pendencia_rh_fora_do_escopo.sql')

function abortar(msg) {
  console.error(`ABORTADO: ${msg}`)
  process.exit(1)
}

const bruto = fs.readFileSync(FONTE, 'utf8')
// Detecta o EOL da fonte, nunca assume (armadilha 59).
const EOL = bruto.includes('\r\n') ? '\r\n' : '\n'

const contar = (texto, agulha) => texto.split(agulha).length - 1

// ---------------------------------------------------------------------------
// 1. Recorta o bloco de fn_promover_pendencia_rh da fonte
// ---------------------------------------------------------------------------
const INICIO = 'DROP FUNCTION IF EXISTS public.fn_promover_pendencia_rh(uuid, uuid, uuid, text, boolean);'
const FIM = 'GRANT EXECUTE ON FUNCTION public.fn_promover_pendencia_rh(uuid, uuid, uuid, text, boolean, text) TO authenticated, service_role;'

const i = bruto.indexOf(INICIO)
const j = bruto.indexOf(FIM)
if (i < 0) abortar('nao achei o DROP de fn_promover_pendencia_rh na fonte')
if (j < 0) abortar('nao achei o GRANT de fn_promover_pendencia_rh na fonte')
let linhas = bruto.slice(i, j + FIM.length).split(EOL)

// ---------------------------------------------------------------------------
// 2. Invariantes ANTES
// ---------------------------------------------------------------------------
const CHECAGEM_CPF = 'SELECT * INTO v_existente FROM public.fn_cpf_ja_cadastrado(v_pend.cpf_normalizado) LIMIT 1;'
const PREFIXO_ATRIB = '    v_cpf_final := COALESCE('
const ANCORA = "        RAISE EXCEPTION 'Pendencia nao encontrada, ou ja foi promovida.';"

const corpoAntes = linhas.join(EOL)
const antes = [
  [CHECAGEM_CPF, 1, 'checagem de CPF por v_pend.cpf_normalizado'],
  [PREFIXO_ATRIB, 1, 'atribuicao de v_cpf_final'],
  [ANCORA, 1, 'ancora "pendencia nao encontrada"'],
  ['fn_servidor_por_matricula(v_pend.matricula)', 1, 'guard de colisao de matricula'],
  ['CPF ja cadastrado como % (matricula %)', 1, 'mensagem de CPF ja cadastrado'],
  ['fn_cpf_digito_valido(v_cpf_final)', 1, 'validacao de digito do CPF'],
  ['INSERT INTO public.servidores', 1, 'INSERT do cadastro novo'],
  ['get_my_role()', 1, 'guard de papel'],
  ['fn_unidade_no_escopo(p_unidade_id)', 1, 'guard de escopo de unidade'],
  ['v_cpf_final, p_cargo', 1, 'o INSERT grava v_cpf_final'],
]
for (const [agulha, esperado, nome] of antes) {
  const achou = contar(corpoAntes, agulha)
  if (achou !== esperado) abortar(`invariante ANTES "${nome}": esperava ${esperado}, achei ${achou}`)
}

// ---------------------------------------------------------------------------
// 3. Substituicoes pontuais, por linha
// ---------------------------------------------------------------------------

// (a) tira a linha da atribuicao de onde ela esta hoje (logo antes do RAISE de CPF obrigatorio),
//     guardando o TEXTO ORIGINAL - assim o regexp do Postgres viaja intacto, sem reescrita.
const idxAtrib = linhas.findIndex(l => l.startsWith(PREFIXO_ATRIB))
if (idxAtrib < 0) abortar('nao achei a linha da atribuicao de v_cpf_final')
const linhaAtribuicao = linhas[idxAtrib]
linhas.splice(idxAtrib, 1)

// (b) reinsere logo depois do "IF NOT FOUND ... pendencia nao encontrada ... END IF;"
const idxAncora = linhas.findIndex(l => l === ANCORA)
if (idxAncora < 0) abortar('nao achei a ancora da pendencia')
if (linhas[idxAncora + 1].trim() !== 'END IF;') {
  abortar(`esperava "END IF;" logo depois da ancora, veio ${JSON.stringify(linhas[idxAncora + 1])}`)
}
linhas.splice(idxAncora + 2, 0,
  '',
  '    -- NOVO (16/09/2026): o CPF que de fato vai ser gravado ja e conhecido aqui - o da pendencia,',
  '    -- ou o que a tela coletou quando o relatorio do RH nao trouxe nenhum. A checagem de',
  '    -- duplicidade abaixo passa a olhar ELE. Antes ela olhava so v_pend.cpf_normalizado, entao um',
  '    -- CPF digitado na tela que ja pertence a outro cadastro criava a duplicata EM SILENCIO, sem',
  '    -- perguntar nada - que e exatamente o que esta tela existe para impedir (armadilha 50).',
  '    -- A validacao de obrigatoriedade e de digito continua onde estava, logo antes do INSERT:',
  '    -- mover so a atribuicao mantem a ordem das mensagens que a tela ja conhece.',
  linhaAtribuicao,
)

// (c) a checagem passa a usar v_cpf_final
const idxCheck = linhas.findIndex(l => l.includes(CHECAGEM_CPF))
if (idxCheck < 0) abortar('nao achei a linha da checagem de CPF')
linhas[idxCheck] = linhas[idxCheck].replace(
  'fn_cpf_ja_cadastrado(v_pend.cpf_normalizado)',
  'fn_cpf_ja_cadastrado(v_cpf_final)')

let corpo = linhas.join(EOL)

// ---------------------------------------------------------------------------
// 4. Invariantes DEPOIS
// ---------------------------------------------------------------------------
const depois = [
  ['fn_cpf_ja_cadastrado(v_cpf_final)', 1, 'checagem passou a usar v_cpf_final'],
  ['fn_cpf_ja_cadastrado(v_pend.cpf_normalizado)', 0, 'nenhuma checagem sobrou em v_pend.cpf_normalizado'],
  [PREFIXO_ATRIB, 1, 'v_cpf_final atribuido uma vez so'],
  ["regexp_replace(COALESCE(p_cpf, '')", 1, 'o regexp do CPF digitado viajou intacto'],
  ['fn_servidor_por_matricula(v_pend.matricula)', 1, 'guard de matricula preservado'],
  ['CPF e obrigatorio para concluir o cadastro', 1, 'RAISE de CPF obrigatorio preservado'],
  ['fn_cpf_digito_valido(v_cpf_final)', 1, 'validacao de digito preservada'],
  ['get_my_role()', 1, 'guard de papel preservado'],
  ['fn_unidade_no_escopo(p_unidade_id)', 1, 'guard de escopo preservado'],
  ['INSERT INTO public.servidores', 1, 'INSERT preservado'],
  ['v_cpf_final, p_cargo', 1, 'o INSERT continua gravando v_cpf_final'],
]
for (const [agulha, esperado, nome] of depois) {
  const achou = contar(corpo, agulha)
  if (achou !== esperado) abortar(`invariante DEPOIS "${nome}": esperava ${esperado}, achei ${achou}`)
}

// A linha da atribuicao tem que ser IDENTICA a da fonte - o regexp nao pode ter sido reescrito.
if (!corpo.includes(linhaAtribuicao)) abortar('a linha da atribuicao foi alterada na copia')

// Ordem: atribuir ANTES de checar, senao a checagem ve NULL.
if (corpo.indexOf(PREFIXO_ATRIB) > corpo.indexOf('fn_cpf_ja_cadastrado(v_cpf_final)')) {
  abortar('v_cpf_final e atribuido DEPOIS da checagem - a checagem veria NULL')
}
// E matricula continua vindo antes de CPF (prioridade de 20260812110000).
if (corpo.indexOf('fn_servidor_por_matricula(') > corpo.indexOf('fn_cpf_ja_cadastrado(')) {
  abortar('guard de matricula deixou de vir antes do de CPF')
}
// Nenhuma linha do corpo pode ter ficado com EOL misto.
if (corpo.includes('\n') && EOL === '\r\n' && /[^\r]\n/.test(corpo)) {
  abortar('corpo ficou com EOL misto')
}

if (require.main === module) {
  const norm = t => t.replace(/\r\n/g, '\n').split('\n').join(EOL)
  const cabecalho = norm(fs.readFileSync(path.join(__dirname, 'cabecalho_conflito_pendencia.sql'), 'utf8'))
  const rodape = norm(fs.readFileSync(path.join(__dirname, 'rodape_conflito_pendencia.sql'), 'utf8'))
  const saida = cabecalho + corpo + EOL + rodape
  if (/[^\r]\n/.test(saida)) abortar('saida final ficou com EOL misto')
  fs.writeFileSync(DESTINO, saida, 'utf8')
  console.log(`OK - ${path.basename(DESTINO)} gerado (${saida.split(EOL).length} linhas, EOL ${JSON.stringify(EOL)})`)
}
