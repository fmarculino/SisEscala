/**
 * Gera supabase/migrations/20260910120000_troca_de_turno_em_linha_regular.sql
 *
 * COPIA MECANICA de fn_alterar_turno_escala_diaria (armadilha 1 do CLAUDE.md): o corpo vigente e'
 * lido do arquivo da migration que o definiu e sofre substituicoes PONTUAIS, com contagem. Nada e'
 * redigitado a mao.
 *
 * O EOL e' DETECTADO, nunca assumido (armadilha 59): montar o padrao com o EOL errado faz o
 * replace virar no-op silencioso e o gerador "passar" sem ter trocado nada.
 */
const fs = require('fs')
const path = require('path')

const RAIZ = path.resolve(__dirname, '..')
const FONTE = path.join(RAIZ, 'supabase/migrations/20260821110000_shift_change_history_and_justification.sql')
const ALVO = path.join(RAIZ, 'supabase/migrations/20260910120000_troca_de_turno_em_linha_regular.sql')

const src = fs.readFileSync(FONTE, 'utf8')
const EOL = src.includes('\r\n') ? '\r\n' : '\n'
const L = (...linhas) => linhas.join(EOL)

function morre(msg) { console.error('ABORTADO: ' + msg); process.exit(1) }
function conta(texto, agulha) { return texto.split(agulha).length - 1 }
function exigeUma(texto, agulha, rotulo) {
  const n = conta(texto, agulha)
  if (n !== 1) morre(rotulo + ': esperava 1 ocorrencia, achei ' + n)
}

// ---------------------------------------------------------------------------
// 1. Extrai a funcao vigente, verbatim.
// ---------------------------------------------------------------------------
const INI = 'CREATE OR REPLACE FUNCTION public.fn_alterar_turno_escala_diaria('
const FIM = '$fn$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;'
exigeUma(src, INI, 'CREATE da fn_alterar_turno_escala_diaria na fonte')
exigeUma(src, FIM, 'fim da fn_alterar_turno_escala_diaria na fonte')

const a = src.indexOf(INI)
const b = src.indexOf(FIM) + FIM.length
let fn = src.slice(a, b)

// ---------------------------------------------------------------------------
// 2. Substituicoes pontuais.
// ---------------------------------------------------------------------------

// 2.a - variavel que diz se a justificativa de evento foi mesmo escrita. Relatar o que MUDOU,
// nunca o que foi calculado (armadilha 22).
const DECL_ANT = L('    v_just_texto TEXT;', 'BEGIN')
exigeUma(fn, DECL_ANT, 'fim do DECLARE')
fn = fn.replace(DECL_ANT, () => L(
  '    v_just_texto TEXT;',
  '    -- Diz se a justificativa de EVENTO foi mesmo escrita. Categoria Regular nunca escreve:',
  '    -- quem relata precisa saber disso para nao prometer um relatorio que nao existe.',
  '    v_evento_justificado BOOLEAN := false;',
  'BEGIN'))

// 2.b - o bloco inteiro da justificativa de evento passa a ser condicional.
const BLOCO_INI = '    -- Justificativa do evento, para o relatorio de plantao. A tabela tem UMA linha por'
const BLOCO_FIM = L('', '    RETURN jsonb_build_object(')
exigeUma(fn, BLOCO_INI, 'inicio do bloco de justificativa de evento')
exigeUma(fn, BLOCO_FIM, 'RETURN final')

const i0 = fn.indexOf(BLOCO_INI)
const i1 = fn.indexOf(BLOCO_FIM)
if (i1 <= i0) morre('o RETURN final aparece ANTES do bloco de justificativa - fonte inesperada')

const bloco = fn.slice(i0, i1)
if (conta(bloco, 'INSERT INTO public.justificativas_eventos') !== 1) {
  morre('o bloco extraido nao contem exatamente 1 INSERT em justificativas_eventos')
}
if (conta(bloco, 'UPDATE public.justificativas_eventos') !== 1) {
  morre('o bloco extraido nao contem exatamente 1 UPDATE em justificativas_eventos')
}

// Reindenta 4 espacos: o bloco passa a viver dentro de um IF.
const blocoIndentado = bloco
  .split(EOL)
  .map(l => (l.trim() === '' ? l : '    ' + l))
  .join(EOL)

const guarda = L(
  '    -- SO CATEGORIA DE EVENTO TEM JUSTIFICATIVA DE EVENTO (10/09/2026).',
  '    -- justificativas_eventos.categoria tem CHECK que aceita apenas Extra, Plantao e Sobreaviso.',
  '    -- Trocar o turno de uma linha REGULAR com ponto morria aqui, em 23514, e a transacao inteira',
  '    -- voltava atras: a troca nao acontecia, e a tela mostrava a mensagem crua do Postgres.',
  '    -- O motivo continua registrado - quem guarda o ato e o historico append-only',
  '    -- (escala_diaria_turno_historico), escrito pela trigger acima, para QUALQUER categoria.',
  '    IF public.fn_categoria_tem_justificativa_evento(p_categoria) THEN',
  blocoIndentado,
  '        v_evento_justificado := true;',
  '    END IF;',
  '')

fn = fn.slice(0, i0) + guarda + fn.slice(i1)

// 2.c - o retorno passa a dizer se houve justificativa de evento.
const RET_ANT = L("        'justificativa_evento_id', v_just_id", '    );')
exigeUma(fn, RET_ANT, 'chave justificativa_evento_id no retorno')
fn = fn.replace(RET_ANT, () => L(
  "        'justificativa_evento_registrada', v_evento_justificado,",
  "        'justificativa_evento_id', v_just_id",
  '    );'))

// ---------------------------------------------------------------------------
// 3. Invariantes do RESULTADO. Tudo que a funcao ja protegia continua no lugar.
// ---------------------------------------------------------------------------
const invariantes = [
  ["RAISE EXCEPTION 'Justificativa obrigatoria", 1, 'justificativa obrigatoria'],
  ["IF v_status = 'Fechada' THEN", 1, 'guard de escala fechada'],
  ["set_config('sisescala.justificativa_turno'", 2, 'publicacao e limpeza do GUC da trigger'],
  ['UPDATE public.escala_diaria', 1, 'UPDATE do turno'],
  ['INSERT INTO public.justificativas_eventos', 1, 'INSERT da justificativa de evento'],
  ['UPDATE public.justificativas_eventos', 1, 'UPDATE da justificativa de evento'],
  ['IF public.fn_categoria_tem_justificativa_evento(p_categoria) THEN', 1, 'guard novo'],
  ['v_evento_justificado := true;', 1, 'marcacao do que foi escrito'],
  ["'justificativa_evento_registrada', v_evento_justificado,", 1, 'chave nova no retorno'],
  ['SECURITY INVOKER', 1, 'SECURITY INVOKER preservado'],
]
for (const inv of invariantes) {
  const n = conta(fn, inv[0])
  if (n !== inv[1]) morre(inv[2] + ': esperava ' + inv[1] + ', achei ' + n)
}

// As duas escritas em justificativas_eventos precisam estar DENTRO do guard. Sem esta checagem,
// um guard colocado no lugar errado passaria por todas as contagens acima.
const g = fn.indexOf('IF public.fn_categoria_tem_justificativa_evento(p_categoria) THEN')
const endIf = fn.indexOf('    END IF;', fn.indexOf('v_evento_justificado := true;'))
for (const escrita of ['INSERT INTO public.justificativas_eventos', 'UPDATE public.justificativas_eventos']) {
  const p = fn.indexOf(escrita)
  if (!(p > g && p < endIf)) morre(escrita + ' ficou FORA do guard')
}
if ((fn.match(/\$fn\$/g) || []).length !== 2) morre('delimitadores $fn$ desbalanceados')

// ---------------------------------------------------------------------------
// 4. Monta a migration.
// ---------------------------------------------------------------------------
const cabecalho = fs.readFileSync(path.join(__dirname, '_troca_turno_cabecalho.sql'), 'utf8')
const conferencia = fs.readFileSync(path.join(__dirname, '_troca_turno_conferencia.sql'), 'utf8')

const saida = [cabecalho.replace(/\r?\n/g, EOL), fn, conferencia.replace(/\r?\n/g, EOL)].join(EOL + EOL)
fs.writeFileSync(ALVO, saida.replace(/\r?\n/g, EOL), 'utf8')

console.log('OK: ' + path.relative(RAIZ, ALVO))
console.log('    corpo copiado de 20260821110000, ' + fn.length + ' bytes, EOL ' + JSON.stringify(EOL))
