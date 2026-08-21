/**
 * Gera a migration que fecha Sobreaviso na regra de afastamento.
 *
 * Copia MECANICAMENTE os corpos vigentes de fn_check_shift_conflicts,
 * fn_prevent_shift_during_event e fn_clean_conflicting_shifts (todos definidos em
 * 20260817210000_add_afastamento_por_horas.sql) e aplica substituicoes pontuais.
 * Aborta se a contagem de ocorrencias divergir — armadilha 1 do CLAUDE.md.
 */
const fs = require('fs')
const path = require('path')

const ORIGEM = 'supabase/migrations/20260817210000_add_afastamento_por_horas.sql'
const DESTINO = 'supabase/migrations/20260820120000_block_all_categories_during_leave.sql'

const src = fs.readFileSync(ORIGEM, 'utf8').replace(/\r\n/g, '\n')

function bloco(marcadorInicio, marcadorFim) {
  const i = src.indexOf(marcadorInicio)
  if (i < 0) throw new Error(`marcador de inicio nao encontrado: ${marcadorInicio}`)
  const j = src.indexOf(marcadorFim, i)
  if (j < 0) throw new Error(`marcador de fim nao encontrado: ${marcadorFim}`)
  return src.slice(i, j)
}

function troca(texto, de, para, esperado = 1) {
  const n = texto.split(de).length - 1
  if (n !== esperado) throw new Error(`ocorrencias=${n} (esperado ${esperado}) para: ${de.slice(0, 70)}`)
  return texto.replace(de, () => para)
}

// --- 1. fn_check_shift_conflicts
let f1 = bloco('CREATE OR REPLACE FUNCTION public.fn_check_shift_conflicts', '-- 3. Atualizar fn_prevent_shift_during_event')
f1 = troca(f1,
  `        IF p_categoria = 'Regular' OR NOT v_permitir_plantao THEN`,
  `        -- Sobreaviso entra ao lado de Regular: a configuracao chama-se
        -- "permitir plantao e extra durante eventos" e nunca foi sobre sobreaviso.
        IF p_categoria IN ('Regular', 'Sobreaviso') OR NOT v_permitir_plantao THEN`)

// --- 2. fn_prevent_shift_during_event
let f2 = bloco('CREATE OR REPLACE FUNCTION public.fn_prevent_shift_during_event', '-- 4. Atualizar fn_prevent_event_during_shift')
f2 = troca(f2,
  `        IF NEW.categoria = 'Regular' OR NOT v_permitir_plantao THEN
            RAISE EXCEPTION 'Não é permitido escalar o servidor no dia % pois ele está em afastamento/evento (%s).', NEW.dia, v_afastamento_nome;
        END IF;`,
  // O format do RAISE tinha '%s' onde o plpgsql so entende '%': o 's' saia colado ao nome
  // do afastamento na mensagem que chega ao coordenador.
  `        IF NEW.categoria IN ('Regular', 'Sobreaviso') OR NOT v_permitir_plantao THEN
            RAISE EXCEPTION 'Nao e permitido escalar o servidor no dia % pois ele esta em afastamento/evento (%).', NEW.dia, v_afastamento_nome;
        END IF;`)

// --- 3. fn_clean_conflicting_shifts
let f3 = bloco('CREATE OR REPLACE FUNCTION public.fn_clean_conflicting_shifts', '-- 6. Atualizar fn_prevent_overlapping_event')
f3 = troca(f3,
  `      AND ed.categoria = 'Regular'`,
  `      AND ed.categoria IN ('Regular', 'Sobreaviso')`)

const cabecalho = `-- Migration: Block all scale categories during leave
-- Description: Sobreaviso passa a ser bloqueado em dia de afastamento junto com Regular. A
-- configuracao global permitir_plantao_extra_durante_eventos continua valendo, mas apenas
-- para Plantao e Extra - que e o que o nome dela sempre disse. Corrige tambem o format do
-- RAISE de fn_prevent_shift_during_event, que imprimia um 's' solto colado ao nome do
-- afastamento ('%s' onde plpgsql so entende '%').
--
-- Copia mecanica de 20260817210000_add_afastamento_por_horas.sql via
-- scratchpad/gen_afastamento_categorias.js. Nao editar a mao.
--
-- Medido em producao em 20/08/2026 antes de aplicar: 2.340 linhas de escala_diaria de
-- servidores com afastamento, 131 afastamentos na base, ZERO linhas gravadas dentro de
-- afastamento bloqueante em qualquer categoria. Nenhuma linha existente passa a violar a
-- regra nova, entao o trigger nao quebra UPDATE de linha ja gravada.

`

const trigger = [
  '',
  '-- Reafirma o gatilho. Ele existe desde 20260601130000, mas repeti-lo aqui torna a',
  '-- migration autossuficiente: em um ambiente sem o gatilho instalado as funcoes acima',
  '-- nao valeriam nada em escala_diaria.',
  'DROP TRIGGER IF EXISTS trigger_prevent_shift_during_event ON public.escala_diaria;',
  'CREATE TRIGGER trigger_prevent_shift_during_event',
  'BEFORE INSERT OR UPDATE ON public.escala_diaria',
  'FOR EACH ROW',
  'EXECUTE FUNCTION public.fn_prevent_shift_during_event();',
  ''
].join(String.fromCharCode(10))

const saida = cabecalho + f1.trimEnd() + '\n\n' + f2.trimEnd() + '\n\n' + f3.trimEnd() + '\n' + trigger

// Conferencia estrutural do arquivo inteiro
const nDollar = (saida.match(/\$\$/g) || []).length
if (nDollar % 2 !== 0) throw new Error(`delimitadores $$ impares: ${nDollar}`)
const nCreate = (saida.match(/CREATE OR REPLACE FUNCTION/g) || []).length
if (nCreate !== 3) throw new Error(`CREATE OR REPLACE FUNCTION = ${nCreate}, esperado 3`)
for (const nome of ['fn_check_shift_conflicts', 'fn_prevent_shift_during_event', 'fn_clean_conflicting_shifts']) {
  if (!saida.includes(`FUNCTION public.${nome}`)) throw new Error(`funcao ausente: ${nome}`)
}
if ((saida.match(/IN \('Regular', 'Sobreaviso'\)/g) || []).length !== 3) {
  throw new Error('as 3 substituicoes de categoria nao estao presentes')
}
if (saida.includes(`= 'Regular' OR NOT v_permitir_plantao`)) throw new Error('sobrou comparacao antiga de categoria')
if ((saida.match(/CREATE TRIGGER trigger_prevent_shift_during_event/g) || []).length !== 1) throw new Error('gatilho ausente ou duplicado')

fs.writeFileSync(DESTINO, saida.replace(/\n/g, '\r\n'))
console.log('gerado', DESTINO, saida.split('\n').length, 'linhas')
