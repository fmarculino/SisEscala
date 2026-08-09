/**
 * Gera 20260809160000: a unidade deixa de escolher QUAIS registros avisam.
 * Copia mecanicamente fn_enfileirar_aviso_ponto de 20260809150000 e remove só o filtro de
 * eventos da unidade. Aborta em qualquer divergência — CLAUDE.md, armadilha 1.
 */
const fs = require('fs')
const BASE = 'c:/Users/Cliente/Projetos/SisEscala/supabase/migrations/'
const src = fs.readFileSync(BASE + '20260809150000_punch_notice_enabled_per_sector.sql', 'utf8').replace(/\r\n/g, '\n')

const i = src.indexOf('CREATE OR REPLACE FUNCTION public.fn_enfileirar_aviso_ponto')
if (i < 0) throw new Error('ABORTA: não achei o trigger')
const fim = src.indexOf('\n$fn$;', i)
let trg = src.slice(i, fim + '\n$fn$;'.length)

const conta = (t, s) => t.split(s).length - 1
const trocar = (de, para, rotulo) => {
  if (conta(trg, de) !== 1) throw new Error(`ABORTA: "${rotulo}" achado ${conta(trg, de)}x`)
  trg = trg.split(de).join(para)
}

// 1. a unidade deixa de ser lida para saber os eventos - só o nome importa agora
trocar(
  '    SELECT u.id, u.nome, u.aviso_ponto_eventos\n      INTO v_unidade',
  '    SELECT u.id, u.nome\n      INTO v_unidade',
  'select da unidade')

// 2. some o filtro de eventos da unidade
trocar(
`    IF NOT (v_evento = ANY (v_unidade.aviso_ponto_eventos)) THEN
        RETURN NULL;
    END IF;

`,
'',
  'filtro de eventos da unidade')

// 3. o comentário do bloco de modo passa a explicar que a decisão é só do servidor
trocar(
  '    -- ---- NOVO: o modo escolhido pelo servidor -----------------------------',
  '    -- ---- Quais registros avisam: decisao do SERVIDOR, e so dele ------------\n' +
  '    -- A unidade decide SE envia; o servidor decide O QUE recebe. Ate 09/08/2026 a unidade\n' +
  '    -- tambem escolhia os eventos (unidades.aviso_ponto_eventos) e o filtro dela rodava ANTES\n' +
  '    -- deste - entao quem escolhesse "todas as batidas" recebia so duas se a unidade tivesse\n' +
  '    -- desmarcado o intervalo, sem nada explicando. Pior: fora_janela estava na lista da\n' +
  '    -- unidade e podia ser desmarcado, quebrando a unica garantia valida em todos os modos.',
  'comentario do bloco de modo')

// ---- conferências ----
if (conta(trg, '$fn$') !== 2) throw new Error('ABORTA: $fn$ desbalanceado')
if (conta(trg, 'CREATE OR REPLACE FUNCTION') !== 1) throw new Error('ABORTA: CREATE duplicado')
// Referência de CÓDIGO, não menção em comentário — o comentário novo cita o nome da coluna de
// propósito, para explicar o que saiu. Um guard por palavra solta acusaria a própria documentação.
for (const ref of ['v_unidade.aviso_ponto_eventos', 'u.aviso_ponto_eventos']) {
  if (trg.includes(ref)) throw new Error('ABORTA: sobrou referencia de codigo: ' + ref)
}
const semComentarios = trg.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
if (semComentarios.includes('aviso_ponto_eventos')) {
  throw new Error('ABORTA: aviso_ponto_eventos aparece fora de comentario')
}

for (const g of ['EXCEPTION WHEN OTHERS', "origem NOT IN ('terminal', 'rep')", 'sintetica',
                 "interval '10 minutes'", 'fn_aviso_ponto_habilitado', "aviso_ponto_status <> 'ativo'",
                 'fn_telefone_aviso_ponto', "v_evento <> 'fora_janela'", "aviso_ponto_modo IN ('resumo_diario', 'resumo_semanal')",
                 'ON CONFLICT (marcacao_id) DO NOTHING', 'presenca_intervalo_retorno_em']) {
  if (!trg.includes(g)) throw new Error(`ABORTA: guard "${g}" sumiu`)
}

const saida = `-- Migration: A unidade decide SE envia; o servidor decide O QUE recebe
-- Data: 2026-08-09
--
-- O PROBLEMA
--   unidades.aviso_ponto_eventos (20260809120000) e servidores.aviso_ponto_modo (20260809140000)
--   respondiam a MESMA pergunta - "quais batidas geram mensagem" - de dois lugares. No gatilho
--   eram dois IF consecutivos, e o da unidade rodava PRIMEIRO.
--
--   Dois danos concretos:
--
--   1. O servidor escolhia "todas as batidas" e recebia so duas, porque a unidade tinha desmarcado
--      os passos de intervalo. Nada na tela dele explicava - o sistema prometia uma coisa e a
--      unidade sobrepunha em silencio.
--
--   2. 'fora_janela' estava na lista da unidade e podia ser DESMARCADO. Isso quebraria a unica
--      garantia que vale em todos os modos: a batida fora do previsto sempre avisa. E justamente
--      o caso em que o silencio prejudica quem bateu - a tela do terminal some em 6 segundos.
--
--   Duas fontes para a mesma regra e como o modulo de marcacoes acabou com tres regras de
--   intervalo divergentes (CLAUDE.md, armadilha 9).
--
-- A DECISAO
--   A unidade (ou o setor) decide SE o recurso esta disponivel ali. O servidor decide O QUE
--   recebe, no Portal - e o consentimento e dele, entao a frequencia tambem deve ser.
--
--   A coluna e REMOVIDA, nao apenas ignorada. Coluna que ninguem le e ninguem mostra e como
--   unidades.configuracoes_comunicacao: fica anos parecendo que configura algo.
--
-- ESTE ARQUIVO E GERADO
--   scratchpad/gen_sem_eventos.js copia o corpo vigente de 20260809150000 e remove apenas o
--   filtro de eventos. Nao editar a mao.


-- ============================================================================
-- 1. GATILHO SEM O FILTRO DA UNIDADE
-- ============================================================================

${trg}


-- ============================================================================
-- 2. A COLUNA SAI
-- ============================================================================
-- Depois da funcao, nunca antes: enquanto a versao anterior do gatilho estiver ativa ela ainda
-- le a coluna, e derruba-la primeiro quebraria toda batida ate o CREATE OR REPLACE terminar.

ALTER TABLE public.unidades DROP COLUMN IF EXISTS aviso_ponto_eventos;


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1. A coluna sumiu (esperado: 0 linhas):
--
--      SELECT column_name FROM information_schema.columns
--       WHERE table_name = 'unidades' AND column_name = 'aviso_ponto_eventos';
--
--   2. O gatilho continua existindo e nenhuma funcao referencia a coluna (esperado: 0):
--
--      SELECT count(*) FROM pg_proc
--       WHERE prosrc LIKE '%aviso_ponto_eventos%';
--
--   3. O que continua valendo por servidor:
--
--      SELECT aviso_ponto_modo, count(*) FROM servidores GROUP BY 1;
`

const destino = BASE + '20260809160000_punch_notice_events_are_servant_choice.sql'
fs.writeFileSync(destino, saida.replace(/\n/g, '\r\n'))
console.log('gerado:', destino)
console.log('  $fn$ =', conta(saida, '$fn$'), '(par)')
console.log('  CREATE OR REPLACE FUNCTION =', conta(saida, 'CREATE OR REPLACE FUNCTION'), '(esperado 1)')
console.log('  referencias a aviso_ponto_eventos fora do comentario/DROP =',
  conta(trg, 'aviso_ponto_eventos'), '(esperado 0)')
