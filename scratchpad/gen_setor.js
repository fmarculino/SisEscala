/**
 * Gera 20260809150000 copiando MECANICAMENTE as duas funções vigentes de 20260809140000
 * e aplicando substituições pontuais. Aborta se qualquer contagem divergir — CLAUDE.md,
 * armadilha 1 (seis regressões já vieram de recopiar corpo de função à mão).
 */
const fs = require('fs')
const BASE = 'c:/Users/Cliente/Projetos/SisEscala/supabase/migrations/'
const src = fs.readFileSync(BASE + '20260809140000_punch_notice_granularity.sql', 'utf8').replace(/\r\n/g, '\n')

const extrai = nome => {
  const i = src.indexOf('CREATE OR REPLACE FUNCTION public.' + nome)
  if (i < 0) throw new Error('não achei ' + nome)
  const fim = src.indexOf('\n$fn$;', i)
  if (fim < 0) throw new Error('não achei fim de ' + nome)
  return src.slice(i, fim + '\n$fn$;'.length)
}

const conta = (t, re) => (t.match(re) || []).length

// ---------------- fn_enfileirar_aviso_ponto ----------------
let trg = extrai('fn_enfileirar_aviso_ponto')

const alvoTrg = `    SELECT u.id, u.nome, u.aviso_ponto_whatsapp, u.aviso_ponto_eventos
      INTO v_unidade
      FROM public.unidades u
     WHERE u.id = NEW.unidade_id;

    IF NOT FOUND OR NOT v_unidade.aviso_ponto_whatsapp THEN
        RETURN NULL;
    END IF;`

if (conta(trg, new RegExp(alvoTrg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) !== 1) {
  throw new Error('ABORTA: bloco da unidade não encontrado exatamente 1x no trigger')
}

trg = trg.replace(alvoTrg, () => `    SELECT u.id, u.nome, u.aviso_ponto_eventos
      INTO v_unidade
      FROM public.unidades u
     WHERE u.id = NEW.unidade_id;

    -- Habilitacao resolvida pelo SETOR, com heranca da unidade. Fonte unica em
    -- fn_aviso_ponto_habilitado - a precedencia nao pode ser reimplementada em cada chamador.
    IF NOT FOUND OR NOT public.fn_aviso_ponto_habilitado(NEW.unidade_id, NEW.setor_id) THEN
        RETURN NULL;
    END IF;`)

// ---------------- fn_gerar_resumos_aviso_ponto ----------------
let res = extrai('fn_gerar_resumos_aviso_ponto')

const trocas = [
  // diario: o filtro da unidade vira o resolvedor com o setor da escala
  ['           AND u.aviso_ponto_whatsapp\n           AND ed.presenca_entrada_em IS NOT NULL',
   '           AND public.fn_aviso_ponto_habilitado(em.unidade_id, em.setor_id)\n           AND ed.presenca_entrada_em IS NOT NULL'],
  // semanal
  ['               AND u.aviso_ponto_whatsapp\n               AND NOT EXISTS (',
   '               AND public.fn_aviso_ponto_habilitado(s.unidade_id, s.setor_id)\n               AND NOT EXISTS ('],
]

for (const [de, para] of trocas) {
  const n = conta(res, new RegExp(de.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))
  if (n !== 1) throw new Error('ABORTA: padrão do resumo achado ' + n + 'x: ' + de.slice(0, 50))
  res = res.replace(de, () => para)
}

// ---------------- conferências pós-substituição ----------------
const checa = (t, nome) => {
  if (conta(t, /\$fn\$/g) !== 2) throw new Error('ABORTA: $fn$ desbalanceado em ' + nome)
  if (conta(t, /CREATE OR REPLACE FUNCTION/g) !== 1) throw new Error('ABORTA: CREATE duplicado em ' + nome)
  if (/u\.aviso_ponto_whatsapp/.test(t)) throw new Error('ABORTA: sobrou leitura direta de u.aviso_ponto_whatsapp em ' + nome)
}
checa(trg, 'trigger'); checa(res, 'resumos')

// guards que NAO podem ter sumido
for (const [t, nome, guards] of [
  [trg, 'trigger', ['EXCEPTION WHEN OTHERS', "origem NOT IN ('terminal', 'rep')", 'sintetica', "interval '10 minutes'",
                    "aviso_ponto_status <> 'ativo'", 'fn_telefone_aviso_ponto', "v_evento <> 'fora_janela'",
                    'aviso_ponto_eventos', 'ON CONFLICT (marcacao_id) DO NOTHING']],
  [res, 'resumos', ['EXCEPTION WHEN OTHERS', "aviso_ponto_status = 'ativo'", 'fn_telefone_aviso_ponto',
                    "interval '3 days'", 'bool_and', 'ON CONFLICT DO NOTHING', 'isodow']],
]) {
  for (const g of guards) if (!t.includes(g)) throw new Error(`ABORTA: guard "${g}" sumiu de ${nome}`)
}

const cabecalho = `-- Migration: Aviso de ponto habilitado por SETOR, com heranca da unidade
-- Data: 2026-08-09
--
-- MOTIVACAO
--   O toggle nasceu por UNIDADE. Para o piloto isso e grosso demais: a TI da SMS tem 6 servidores,
--   mas ligar a unidade SMS habilitaria os 78 da secretaria inteira - 13x o escopo pretendido.
--   O double opt-in impede que alguem receba sem pedir, mas TORNA A OPCAO VISIVEL a 78 pessoas
--   quando a intencao e 6, e adesao fora do grupo desmonta a leitura do piloto.
--
--   O projeto ja tem esse padrao: geolocalizacao e cadastrada no setor e cai para a unidade quando
--   ausente (v1.7.0). Mesma forma aqui.
--
-- PRECEDENCIA
--   setores.aviso_ponto_whatsapp:
--     NULL  -> herda a unidade  (padrao de todos os setores existentes)
--     true  -> liga  este setor, mesmo com a unidade desligada
--     false -> desliga este setor, mesmo com a unidade ligada
--
--   A resolucao vive em UM lugar so - fn_aviso_ponto_habilitado. Reimplementar a precedencia em
--   cada chamador e como o modulo de marcacoes acabou com tres regras de intervalo divergentes.
--
-- ESTE ARQUIVO E GERADO
--   scratchpad/gen_setor.js copia as duas funcoes vigentes de 20260809140000 e aplica
--   substituicoes pontuais, abortando se qualquer contagem ou guard divergir. Nao editar a mao.


-- ============================================================================
-- 1. COLUNA NO SETOR
-- ============================================================================

ALTER TABLE public.setores
    ADD COLUMN IF NOT EXISTS aviso_ponto_whatsapp boolean;

COMMENT ON COLUMN public.setores.aviso_ponto_whatsapp IS
    'NULL herda a unidade; true/false sobrepoe. Ver fn_aviso_ponto_habilitado.';


-- ============================================================================
-- 2. FONTE UNICA DA PRECEDENCIA
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_aviso_ponto_habilitado(
    p_unidade_id uuid,
    p_setor_id   uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT COALESCE(
        (SELECT st.aviso_ponto_whatsapp FROM public.setores  st WHERE st.id = p_setor_id),
        (SELECT u.aviso_ponto_whatsapp  FROM public.unidades u  WHERE u.id  = p_unidade_id),
        false)
$fn$;

COMMENT ON FUNCTION public.fn_aviso_ponto_habilitado(uuid, uuid) IS
    'Aviso de ponto vale para este setor? Setor sobrepoe unidade; NULL herda; sem nada, false.';

GRANT EXECUTE ON FUNCTION public.fn_aviso_ponto_habilitado(uuid, uuid) TO authenticated, service_role;


-- ============================================================================
-- 3. GATILHO - copia mecanica de 20260809140000, so a checagem da unidade mudou
-- ============================================================================

`

const rodape = `

-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1. Ninguem foi ligado por engano (esperado: 0 linhas):
--
--      SELECT id FROM setores WHERE aviso_ponto_whatsapp IS NOT NULL;
--
--   2. A precedencia responde (esperado: false em tudo, nada ligado ainda):
--
--      SELECT u.nome, public.fn_aviso_ponto_habilitado(s.unidade_id, s.id)
--        FROM setores s JOIN unidades u ON u.id = s.unidade_id LIMIT 5;
--
--   3. Ligar o PILOTO - so a TI da SMS, sem tocar na unidade:
--
--      UPDATE setores SET aviso_ponto_whatsapp = true
--       WHERE id IN (SELECT s.id FROM setores s
--                      JOIN dicionario_setores d ON d.id = s.dicionario_setor_id
--                      JOIN unidades u ON u.id = s.unidade_id
--                     WHERE d.nome = 'TECNOLOGIA DA INFORMAÇÃO'
--                       AND u.nome LIKE 'SMS%');
--
--   4. Conferir que so a TI ficou habilitada (esperado: 6 servidores):
--
--      SELECT count(*) FROM servidores s
--       WHERE public.fn_aviso_ponto_habilitado(s.unidade_id, s.setor_id);
`

const saida = cabecalho + trg + `


-- ============================================================================
-- 4. RESUMOS - copia mecanica, so os filtros de habilitacao mudaram
-- ============================================================================

` + res + rodape

const destino = BASE + '20260809150000_punch_notice_enabled_per_sector.sql'
fs.writeFileSync(destino, saida.replace(/\n/g, '\r\n'))
console.log('gerado:', destino)
console.log('  linhas =', saida.split('\n').length)
console.log('  $fn$   =', conta(saida, /\$fn\$/g), '(deve ser par)')
console.log('  CREATE OR REPLACE FUNCTION =', conta(saida, /CREATE OR REPLACE FUNCTION/g), '(esperado 3)')
console.log('  fn_aviso_ponto_habilitado usada =', conta(saida, /fn_aviso_ponto_habilitado/g), 'vezes')
