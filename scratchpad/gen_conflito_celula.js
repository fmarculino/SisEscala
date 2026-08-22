/**
 * Gera a migration que faz fn_check_shift_conflicts ignorar a PROPRIA celula editada.
 *
 * Copia mecanica do corpo vigente (20260820120000), com substituicoes pontuais e
 * conferencia de contagem — armadilha 1 do CLAUDE.md. Aborta em qualquer divergencia.
 */
const fs = require('fs')
const path = require('path')

const ORIGEM = 'supabase/migrations/20260820120000_block_all_categories_during_leave.sql'
const DESTINO = 'supabase/migrations/20260821100000_conflict_check_ignores_own_cell.sql'

const src = fs.readFileSync(ORIGEM, 'utf8')

// 1. Extrair apenas o bloco de fn_check_shift_conflicts
const ini = src.indexOf('CREATE OR REPLACE FUNCTION public.fn_check_shift_conflicts(')
if (ini < 0) throw new Error('funcao nao encontrada na origem')
const fimMarca = '$function$;'
const fim = src.indexOf(fimMarca, ini)
if (fim < 0) throw new Error('delimitador final nao encontrado')
let fn = src.slice(ini, fim + fimMarca.length)

const conta = (txt, alvo) => txt.split(alvo).length - 1

// 2. Substituicoes pontuais, cada uma com contagem esperada
const subs = [
  {
    de: "    p_categoria TEXT DEFAULT 'Regular'\r\n)",
    para: "    p_categoria TEXT DEFAULT 'Regular',\r\n    p_escala_mensal_id UUID DEFAULT NULL\r\n)",
    n: 1
  },
  {
    de: "    -- 3. Verificar conflito de escala diária existente (mesmo dia, outra unidade/setor, slots sobrepostos)\r\n",
    para: "    -- 3. Verificar conflito de escala diaria existente (mesmo dia, outra unidade/setor, slots sobrepostos)\r\n" +
          "    -- p_escala_mensal_id identifica a CELULA que esta sendo editada: (escala_mensal, categoria, dia)\r\n" +
          "    -- e exatamente a chave de uma celula da grade. Sem excluir essa linha, trocar o codigo de um\r\n" +
          "    -- turno ja salvo por outro que compartilhe qualquer slot faz a funcao conflitar a celula com\r\n" +
          "    -- ELA MESMA (medido em 21/08/2026: MT -> MT devolvia conflito). Com a remocao da celula\r\n" +
          "    -- bloqueada por presenca (Direito Adquirido), o dia com ponto registrado ficava congelado:\r\n" +
          "    -- nao dava para apagar nem para trocar. NULL preserva o comportamento antigo.\r\n",
    n: 1
  },
  {
    de: "      AND ed.dia = p_dia\r\n      AND dt.slots && v_turno_slots\r\n    LIMIT 1;",
    para: "      AND ed.dia = p_dia\r\n      AND dt.slots && v_turno_slots\r\n" +
          "      AND NOT (\r\n" +
          "          p_escala_mensal_id IS NOT NULL\r\n" +
          "          AND em.id = p_escala_mensal_id\r\n" +
          "          AND ed.categoria = p_categoria::public.escala_categoria\r\n" +
          "      )\r\n    LIMIT 1;",
    n: 1
  }
]

for (const s of subs) {
  const achou = conta(fn, s.de)
  if (achou !== s.n) throw new Error(`esperava ${s.n} ocorrencia(s) de:\n${s.de}\nachou ${achou}`)
  fn = fn.split(s.de).join(s.para)
}

const cabecalho = [
  '-- Migration: Conflict check ignores the cell being edited',
  '-- Description: fn_check_shift_conflicts passa a aceitar p_escala_mensal_id e a excluir da busca',
  '-- de conflito a propria celula (escala_mensal + categoria + dia) que o coordenador esta editando.',
  '--',
  '-- Medido em 21/08/2026 (homologacao, chamada real da RPC sobre uma linha existente de Plantao MT):',
  '--   MT   slots [M,T] -> conflito: "Conflito com o turno MT no setor LIMPEZA (LACEM)"',
  '--   MT4  slots [M,T] -> conflito com a mesma linha',
  '--   MTN  slots [M,T,N] -> conflito com a mesma linha',
  '--   N    slots [N]   -> sem conflito (nenhum slot em comum)',
  '-- Ou seja: reescrever a celula com o MESMO codigo ja era recusado. Quem nao tinha presenca no',
  '-- dia contornava apagando a celula, salvando e digitando de novo; com presenca registrada a',
  '-- remocao e barrada pelo Direito Adquirido e a celula ficava impossivel de corrigir - inclusive',
  '-- para dobra de plantao (T 13-19 emendando na noite, que o dicionario ja resolve com TN).',
  '--',
  '-- A deteccao de conflito real (mesmo servidor em DUAS escalas no mesmo dia com slots sobrepostos)',
  '-- continua intacta: so a linha da propria celula sai da busca, e apenas quando o chamador informa',
  '-- qual e. p_escala_mensal_id NULL preserva o comportamento anterior.',
  '--',
  '-- Copia mecanica de 20260820120000_block_all_categories_during_leave.sql via',
  '-- scratchpad/gen_conflito_celula.js. Nao editar a mao.',
  '--',
  '-- DROP antes do CREATE porque a lista de argumentos muda: com CREATE OR REPLACE o Postgres',
  '-- criaria uma SOBRECARGA, e a chamada de 6 argumentos ficaria ambigua para o PostgREST.',
  '',
  'DROP FUNCTION IF EXISTS public.fn_check_shift_conflicts(UUID, INTEGER, INTEGER, INTEGER, UUID, TEXT);',
  '',
  ''
].join('\r\n')

const rodape = [
  '',
  '',
  'GRANT EXECUTE ON FUNCTION public.fn_check_shift_conflicts(UUID, INTEGER, INTEGER, INTEGER, UUID, TEXT, UUID) TO authenticated, service_role;',
  ''
].join('\r\n')

const out = cabecalho + fn + rodape

// 3. Conferencia estrutural do arquivo inteiro
const checks = [
  ['delimitadores $function$ em par', conta(out, '$function$') === 2],
  ['um unico CREATE OR REPLACE', conta(out, 'CREATE OR REPLACE FUNCTION') === 1],
  ['um unico DROP FUNCTION', conta(out, 'DROP FUNCTION') === 1],
  ['um unico GRANT', conta(out, 'GRANT EXECUTE') === 1],
  ['parametro novo presente', conta(out, 'p_escala_mensal_id') === 6],
  ['guard de exclusao presente', conta(out, 'AND em.id = p_escala_mensal_id') === 1],
  ['step 3 preservado', conta(out, 'dt.slots && v_turno_slots') === 1],
  ['step 2 (afastamento) preservado', conta(out, "COALESCE(se.periodo_tipo, 'integral') <> 'horas'") === 1],
  ['guard Regular/Sobreaviso preservado', conta(out, "p_categoria IN ('Regular', 'Sobreaviso')") === 1],
  ['cast do enum de categoria', conta(out, 'ed.categoria = p_categoria::public.escala_categoria') === 1],
  ['CRLF', !/[^\r]\n/.test(out)]
]
const falhas = checks.filter(([, ok]) => !ok).map(([nome]) => nome)
if (falhas.length) throw new Error('conferencia estrutural falhou: ' + falhas.join(', '))

fs.writeFileSync(DESTINO, out, 'utf8')
console.log('gerado:', DESTINO)
checks.forEach(([nome]) => console.log('  ok -', nome))
