/**
 * Gera 20260809170000. Copia mecanicamente fn_solicitar_aviso_ponto de 20260809120000 e insere
 * a checagem de habilitacao da lotacao. Aborta em qualquer divergencia (CLAUDE.md, armadilha 1).
 */
const fs = require('fs')
const BASE = 'c:/Users/Cliente/Projetos/SisEscala/supabase/migrations/'
const src = fs.readFileSync(BASE + '20260809120000_punch_notice_via_whatsapp.sql', 'utf8').replace(/\r\n/g, '\n')

const i = src.indexOf('CREATE OR REPLACE FUNCTION public.fn_solicitar_aviso_ponto')
if (i < 0) throw new Error('ABORTA: nao achei fn_solicitar_aviso_ponto')
let fn = src.slice(i, src.indexOf('\n$fn$;', i) + '\n$fn$;'.length)

const conta = (t, x) => t.split(x).length - 1
const trocar = (de, para, rotulo) => {
  if (conta(fn, de) !== 1) throw new Error(`ABORTA: "${rotulo}" achado ${conta(fn, de)}x`)
  fn = fn.split(de).join(para)
}

// 1. o SELECT passa a trazer a lotacao
trocar(
  '    SELECT s.id, s.nome, s.telefone, s.aviso_ponto_status\n      INTO v_servidor',
  '    SELECT s.id, s.nome, s.telefone, s.aviso_ponto_status, s.unidade_id, s.setor_id\n      INTO v_servidor',
  'select do servidor')

// 2. a checagem entra ANTES do telefone: nao habilitado bloqueia de qualquer jeito, e dizer
//    "sem telefone" a quem esta fora do escopo mandaria a pessoa corrigir a coisa errada.
trocar(
`    v_telefone := public.fn_telefone_aviso_ponto(p_servidor_id);`,
`    -- LOTACAO HABILITADA? Sem isto, quem esta em setor desabilitado clicava em Ativar e o
    -- sistema MANDAVA a mensagem de confirmacao - furando o portao de rollout, e no mesmo numero
    -- que serve o acionamento de sobreaviso. O dano nao era ele nao receber depois; era a
    -- mensagem que ja tinha saido.
    --
    -- Vem ANTES do telefone de proposito: quem esta fora do escopo esta bloqueado de qualquer
    -- forma, e mandar corrigir o cadastro o faria consertar a coisa errada.
    IF NOT public.fn_aviso_ponto_habilitado(v_servidor.unidade_id, v_servidor.setor_id) THEN
        RETURN jsonb_build_object('success', false, 'status', 'indisponivel',
            'message', 'O aviso de ponto ainda não está disponível na sua lotação. '
                    || 'Fale com seu coordenador.');
    END IF;

    v_telefone := public.fn_telefone_aviso_ponto(p_servidor_id);`,
  'checagem de habilitacao')

if (conta(fn, '$fn$') !== 2) throw new Error('ABORTA: $fn$ desbalanceado')
if (conta(fn, 'CREATE OR REPLACE FUNCTION') !== 1) throw new Error('ABORTA: CREATE duplicado')
for (const g of ['O termo de ciência não pode ser vazio', "aviso_ponto_status = 'ativo'",
                 'fn_telefone_aviso_ponto', "tipo = 'confirmacao_optin'", 'pendente_confirmacao',
                 "'solicitou'", 'make_interval', 'Responda SIM']) {
  if (!fn.includes(g)) throw new Error(`ABORTA: guard "${g}" sumiu`)
}

const saida = `-- Migration: Elegibilidade do aviso de ponto - lotacao habilitada e estado efetivo
-- Data: 2026-08-09
--
-- Plano: docs/planos/2026-08-09-escopo-e-elegibilidade-do-aviso-de-ponto.md
--
-- Resolve dois dos tres problemas levantados em 09/08/2026. O terceiro (a tela da unidade nao
-- avisar que setores podem sobrepo-la) e so frontend.
--
-- PROBLEMA A - opt-in sem habilitacao disparava WhatsApp  [o grave]
--   fn_solicitar_aviso_ponto validava termo, servidor, telefone e pedido pendente, e NUNCA
--   consultava fn_aviso_ponto_habilitado. Entao alguem de setor desabilitado clicava em Ativar,
--   o sistema MANDAVA a mensagem de confirmacao, ele respondia SIM e ficava 'ativo' - sem nunca
--   receber aviso de ponto, porque o gatilho barra corretamente.
--
--   O dano nao era o passo final. Era a mensagem enviada por uma lotacao que a coordenacao nao
--   liberou, NO MESMO NUMERO que serve o acionamento de sobreaviso. Durante o piloto da TI,
--   qualquer pessoa da CAF, DMAC ou ALMOXARIFADO que achasse a aba furava o portao de rollout.
--
-- PROBLEMA B - status 'ativo' nao refletia a realidade apos transferencia
--   O gatilho resolve a habilitacao no INSTANTE DA BATIDA, pela lotacao da propria marcacao -
--   entao transferencia para setor desabilitado nunca gerou envio indevido. O defeito era de
--   DADO: "SELECT count(*) ... WHERE aviso_ponto_status = 'ativo'" passava a contar quem nao
--   recebe nada, e essa e justamente a consulta de uma auditoria de consentimento.
--
--   NAO se desativa o servidor na transferencia. Consentimento e sobre a pessoa e o canal;
--   lotacao e sobre disponibilidade. Transferir e ato administrativo - gravar como desativacao
--   atribuiria a ele uma decisao que nao foi dele, no mesmo log que serve de prova. E voltando ao
--   setor de origem ele refaria o double opt-in inteiro, incluindo mais UMA mensagem no numero
--   que estamos protegendo de banimento.
--
--   Em vez disso, separa-se CONSENTIMENTO (aviso_ponto_status, do servidor) de EFETIVIDADE
--   (fn_aviso_ponto_efetivo, que e o que relatorios consultam).
--
-- O QUE CONTINUA INCONDICIONAL
--   Desativar pelo Portal e responder PARAR no WhatsApp NAO dependem de habilitacao nenhuma.
--   Amarrar a saida a configuracao prenderia a pessoa numa preferencia que ela nao pode mudar, e
--   ignorar PARAR e o caminho mais curto para denuncia e banimento.
--
-- ESTE ARQUIVO E GERADO
--   scratchpad/gen_elegibilidade.js copia o corpo vigente de fn_solicitar_aviso_ponto e insere a
--   checagem. Nao editar a mao.


-- ============================================================================
-- 1. ESTADO EFETIVO
-- ============================================================================
-- Consentiu E a lotacao atual esta habilitada. E o que qualquer relatorio de "quem recebe" deve
-- consultar - aviso_ponto_status sozinho responde pelo consentimento, nao pela entrega.

CREATE OR REPLACE FUNCTION public.fn_aviso_ponto_efetivo(p_servidor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT COALESCE(
        (SELECT s.aviso_ponto_status = 'ativo'
              AND public.fn_aviso_ponto_habilitado(s.unidade_id, s.setor_id)
           FROM public.servidores s
          WHERE s.id = p_servidor_id),
        false)
$fn$;

COMMENT ON FUNCTION public.fn_aviso_ponto_efetivo(uuid) IS
    'O servidor recebe aviso de ponto AGORA? Consentimento + lotacao habilitada. Use esta, e nao '
    'aviso_ponto_status sozinho, para contar quem recebe - depois de uma transferencia os dois '
    'divergem de proposito: o consentimento dele nao e apagado por ato administrativo.';

GRANT EXECUTE ON FUNCTION public.fn_aviso_ponto_efetivo(uuid) TO authenticated, service_role;


-- ============================================================================
-- 2. OPT-IN EXIGE LOTACAO HABILITADA
-- ============================================================================

${fn}


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1. Consentimento x efetividade lado a lado (divergem apos transferencia, e isso e correto):
--
--      SELECT s.nome, s.aviso_ponto_status,
--             public.fn_aviso_ponto_habilitado(s.unidade_id, s.setor_id) AS lotacao_ok,
--             public.fn_aviso_ponto_efetivo(s.id)                        AS recebe_agora
--        FROM servidores s
--       WHERE s.aviso_ponto_status <> 'inativo';
--
--   2. Quem REALMENTE recebe (a consulta que os relatorios devem usar):
--
--      SELECT count(*) FROM servidores s WHERE public.fn_aviso_ponto_efetivo(s.id);
--
--   3. O opt-in agora recusa fora do escopo. Com nenhuma unidade/setor habilitado, esperado
--      status 'indisponivel':
--
--      SELECT public.fn_solicitar_aviso_ponto(
--               (SELECT id FROM servidores WHERE aviso_ponto_status = 'inativo' LIMIT 1),
--               'teste', '0');
--
--   4. Setores que sobrepoem a unidade (o que a tela da unidade passa a exibir):
--
--      SELECT u.nome AS unidade, d.nome AS setor, s.aviso_ponto_whatsapp
--        FROM setores s
--        JOIN unidades u ON u.id = s.unidade_id
--        JOIN dicionario_setores d ON d.id = s.dicionario_setor_id
--       WHERE s.aviso_ponto_whatsapp IS NOT NULL;
`

const destino = BASE + '20260809170000_punch_notice_eligibility.sql'
fs.writeFileSync(destino, saida.replace(/\n/g, '\r\n'))
console.log('gerado:', destino)
console.log('  $fn$ =', conta(saida, '$fn$'), '(par)')
console.log('  CREATE OR REPLACE FUNCTION =', conta(saida, 'CREATE OR REPLACE FUNCTION'), '(esperado 2)')
console.log('  fn_aviso_ponto_habilitado citada =', conta(saida, 'fn_aviso_ponto_habilitado'), 'vezes')
