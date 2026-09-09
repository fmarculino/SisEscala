// Gera 20260909140000_sobreposicao_de_escala_por_pessoa.sql a partir das versoes VIGENTES de
// DUAS funcoes, cada uma da sua migration — armadilha 1 (e o modelo de gen_intervalo_plantao.js:
// gerador que le duas fontes e confere invariantes contra cada uma).
//
//   fn_check_shift_conflicts            <- 20260904120000  (a RPC que a grade chama)
//   fn_prevent_cross_sector_shift_overlap <- 20260826220000 (o trigger, rede de seguranca)
//
// O QUE MUDA: as duas passam a enxergar a PESSOA (todos os cadastros Ativos com o mesmo CPF),
// nao a matricula. Duplo vinculo nao autoriza estar em dois lugares no mesmo horario.
const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const F_RPC = path.join(RAIZ, 'supabase/migrations/20260904120000_afastamento_parcial_preserva_o_turno.sql')
const F_TRG = path.join(RAIZ, 'supabase/migrations/20260826220000_prevent_cross_sector_shift_overlap.sql')
const DESTINO = path.join(RAIZ, 'supabase/migrations/20260909140000_sobreposicao_de_escala_por_pessoa.sql')

const brutoRpc = fs.readFileSync(F_RPC, 'utf8')
const CRLF = brutoRpc.includes('\r\n')

function recorta(arquivo, inicio, fimTag) {
  let t = fs.readFileSync(arquivo, 'utf8').replace(/\r\n/g, '\n')
  const i = t.indexOf(inicio)
  if (i < 0) { console.error(`ABORTADO: nao achei "${inicio}" em ${path.basename(arquivo)}`); process.exit(1) }
  const f = t.indexOf(fimTag, i)
  if (f < 0) { console.error(`ABORTADO: nao achei o fim (${fimTag}) em ${path.basename(arquivo)}`); process.exit(1) }
  return t.slice(i, f + fimTag.length)
}

function troca(txt, de, para, esperado, rotulo) {
  const n = txt.split(de).length - 1
  if (n !== esperado) {
    console.error(`ABORTADO [${rotulo}]: esperava ${esperado} de:\n---\n${de.slice(0, 200)}\n---\nachou ${n}`)
    process.exit(1)
  }
  return txt.split(de).join(para)
}

// O SELECT dos irmaos, identico nas duas funcoes: uma copia so seria melhor, mas uma funcao
// auxiliar nova precisaria de GRANT proprio e de sobreviver a toda recriacao das duas — o
// custo de manter as duas copias em sincronia fica com o gerador, que aborta na divergencia.
const SQL_IRMAOS = (varAlvo, varServidor) =>
`    -- A PESSOA, nao a matricula. servidores e "1 linha = 1 vinculo" (o indice unico de CPF foi
    -- derrubado em 20260810140000 de proposito), entao a mesma pessoa pode ter duas matriculas.
    -- Duplo vinculo NAO autoriza estar em dois lugares no mesmo horario: a pessoa continua uma
    -- so. Sem isto a trava nao enxergava nada, porque duas matriculas sao dois servidor_id —
    -- foi assim que EDILEUZA (mat 67454 e 15892) ficou com dois plantoes N simultaneos no mesmo
    -- setor em 01/09/2026, o unico caso da base inteira (89 pares dia-a-dia medidos).
    SELECT COALESCE(array_agg(o.id), ARRAY[${varServidor}])
      INTO ${varAlvo}
      FROM public.servidores o
      JOIN public.servidores eu ON eu.id = ${varServidor}
     WHERE o.status = 'Ativo'
       AND o.mesclado_em_servidor_id IS NULL
       AND (
             o.id = eu.id
          OR (
             length(regexp_replace(COALESCE(eu.cpf, ''), '\\D', '', 'g')) >= 11
         AND right(regexp_replace(COALESCE(o.cpf,  ''), '\\D', '', 'g'), 11)
           = right(regexp_replace(COALESCE(eu.cpf, ''), '\\D', '', 'g'), 11)
             )
           );
`

// ---------------------------------------------------------------------------
// 1. fn_check_shift_conflicts (RPC)
// ---------------------------------------------------------------------------
let rpc = recorta(F_RPC, 'CREATE OR REPLACE FUNCTION public.fn_check_shift_conflicts(', '\n$function$;')

rpc = troca(rpc,
`    v_permitir_plantao BOOLEAN;
BEGIN`,
`    v_permitir_plantao BOOLEAN;
    v_pessoa_ids UUID[];
    v_conflito_matricula TEXT;
    v_conflito_servidor UUID;
BEGIN
${SQL_IRMAOS('v_pessoa_ids', 'p_servidor_id')}`,
  1, 'rpc/declare')

rpc = troca(rpc,
`    SELECT
        ed.id,
        dt.codigo,
        u.nome,
        ds.nome
    INTO
        v_conflito_id,
        v_conflito_codigo,
        v_conflito_unidade,
        v_conflito_setor`,
`    SELECT
        ed.id,
        dt.codigo,
        u.nome,
        ds.nome,
        sv.matricula,
        sv.id
    INTO
        v_conflito_id,
        v_conflito_codigo,
        v_conflito_unidade,
        v_conflito_setor,
        v_conflito_matricula,
        v_conflito_servidor`,
  1, 'rpc/select')

rpc = troca(rpc,
`    JOIN public.dicionario_setores ds ON ds.id = s.dicionario_setor_id
    WHERE em.servidor_id = p_servidor_id
      AND em.mes = p_mes`,
`    JOIN public.dicionario_setores ds ON ds.id = s.dicionario_setor_id
    JOIN public.servidores sv ON sv.id = em.servidor_id
    WHERE em.servidor_id = ANY(v_pessoa_ids)
      AND em.mes = p_mes`,
  1, 'rpc/where')

rpc = troca(rpc,
`    IF v_conflito_id IS NOT NULL THEN
        RETURN QUERY SELECT TRUE, format('Conflito com o turno %s no setor %s (%s).', v_conflito_codigo, v_conflito_setor, v_conflito_unidade);
        RETURN;
    END IF;`,
`    IF v_conflito_id IS NOT NULL THEN
        -- Mensagem PROPRIA quando o conflito vem da OUTRA MATRICULA da mesma pessoa: sem
        -- dizer isso, o coordenador le "conflito com o turno X" e vai procurar na grade dele
        -- um lancamento que nao esta la — esta na escala da outra matricula, que ele pode nem
        -- saber que existe.
        IF v_conflito_servidor IS DISTINCT FROM p_servidor_id THEN
            RETURN QUERY SELECT TRUE, format(
                'Conflito com a outra matricula desta pessoa (%s): ja esta escalada no turno %s '
                || 'em %s (%s) neste dia. A pessoa e uma so — duplo vinculo nao permite dois '
                || 'turnos no mesmo horario.',
                v_conflito_matricula, v_conflito_codigo, v_conflito_setor, v_conflito_unidade);
            RETURN;
        END IF;
        RETURN QUERY SELECT TRUE, format('Conflito com o turno %s no setor %s (%s).', v_conflito_codigo, v_conflito_setor, v_conflito_unidade);
        RETURN;
    END IF;`,
  1, 'rpc/mensagem')

// ---------------------------------------------------------------------------
// 2. fn_prevent_cross_sector_shift_overlap (trigger)
// ---------------------------------------------------------------------------
let trg = recorta(F_TRG, 'CREATE OR REPLACE FUNCTION public.fn_prevent_cross_sector_shift_overlap()', '\n$fn$;')

trg = troca(trg,
`    v_outra_unid   text;
BEGIN`,
`    v_outra_unid   text;
    v_pessoa_ids   uuid[];
    v_outra_matr   text;
    v_outro_serv   uuid;
BEGIN`,
  1, 'trg/declare')

trg = troca(trg,
`    IF v_servidor IS NULL THEN
        RETURN NEW;
    END IF;`,
`    IF v_servidor IS NULL THEN
        RETURN NEW;
    END IF;

${SQL_IRMAOS('v_pessoa_ids', 'v_servidor')}`,
  1, 'trg/irmaos')

trg = troca(trg,
`    SELECT dt.codigo, ds.nome, u.nome
      INTO v_outro_codigo, v_outro_setor, v_outra_unid`,
`    SELECT dt.codigo, ds.nome, u.nome, sv.matricula, sv.id
      INTO v_outro_codigo, v_outro_setor, v_outra_unid, v_outra_matr, v_outro_serv`,
  1, 'trg/select')

trg = troca(trg,
`      JOIN public.dicionario_setores ds ON ds.id = s.dicionario_setor_id
     WHERE em.servidor_id = v_servidor
       AND em.mes = v_mes`,
`      JOIN public.dicionario_setores ds ON ds.id = s.dicionario_setor_id
      JOIN public.servidores sv ON sv.id = em.servidor_id
     WHERE em.servidor_id = ANY(v_pessoa_ids)
       AND em.mes = v_mes`,
  1, 'trg/where')

// A exclusao da propria linha usava "outra escala = outro setor/unidade". Com a pessoa no
// lugar da matricula isso deixa de bastar: a escala da OUTRA matricula tambem tem
// escala_mensal_id diferente, e e justamente ela que precisa conflitar. A condicao correta
// e excluir a propria LINHA (ed.id), que ja esta logo abaixo.
trg = troca(trg,
`       AND ed.escala_mensal_id <> NEW.escala_mensal_id   -- outra escala = outro setor/unidade
       AND ed.id IS DISTINCT FROM NEW.id`,
`       AND (
             ed.escala_mensal_id <> NEW.escala_mensal_id   -- outra escala = outro setor/unidade
          OR em.servidor_id <> v_servidor                  -- ou a outra matricula da pessoa
           )
       AND ed.id IS DISTINCT FROM NEW.id`,
  1, 'trg/exclusao')

trg = troca(trg,
`    IF v_outro_codigo IS NOT NULL THEN
        RAISE EXCEPTION
            'Sobreposicao de escala: o servidor ja esta escalado no dia % com o turno % em % (%). '
            'Um servidor nao pode ocupar dois setores no mesmo horario. Remova o lancamento de la '
            'antes de escalar aqui.',
            NEW.dia, v_outro_codigo, v_outro_setor, v_outra_unid
            USING ERRCODE = 'check_violation';
    END IF;`,
`    IF v_outro_codigo IS NOT NULL THEN
        IF v_outro_serv IS DISTINCT FROM v_servidor THEN
            RAISE EXCEPTION
                'Sobreposicao de escala: esta pessoa ja esta escalada no dia % com o turno % em % (%), '
                'pela matricula %. A pessoa e uma so — duplo vinculo nao permite dois turnos no mesmo '
                'horario. Remova o lancamento de la antes de escalar aqui.',
                NEW.dia, v_outro_codigo, v_outro_setor, v_outra_unid, v_outra_matr
                USING ERRCODE = 'check_violation';
        END IF;
        RAISE EXCEPTION
            'Sobreposicao de escala: o servidor ja esta escalado no dia % com o turno % em % (%). '
            'Um servidor nao pode ocupar dois setores no mesmo horario. Remova o lancamento de la '
            'antes de escalar aqui.',
            NEW.dia, v_outro_codigo, v_outro_setor, v_outra_unid
            USING ERRCODE = 'check_violation';
    END IF;`,
  1, 'trg/mensagem')

// ---------------------------------------------------------------------------
// Invariantes — conferidos contra CADA fonte
// ---------------------------------------------------------------------------
const inv = [
  ['rpc: exclusao da propria celula preservada (armadilha 15)', () => rpc.includes('p_escala_mensal_id IS NOT NULL')],
  ['rpc: afastamento parcial preservado (armadilha 49)', () => rpc.includes('fn_afastamento_dia')],
  ['rpc: pessoa no lugar da matricula', () => rpc.includes('em.servidor_id = ANY(v_pessoa_ids)')],
  ['rpc: um unico CREATE', () => (rpc.split('CREATE OR REPLACE FUNCTION').length - 1) === 1],
  ['trg: guard de UPDATE preservado (presenca passa reto)', () => trg.includes('NEW.dicionario_turnos_id  IS NOT DISTINCT FROM OLD.dicionario_turnos_id')],
  ['trg: criterio continua por SLOT sobreposto', () => trg.includes('dt.slots && v_slots')],
  ['trg: pessoa no lugar da matricula', () => trg.includes('em.servidor_id = ANY(v_pessoa_ids)')],
  ['trg: a outra matricula nao e excluida da busca', () => trg.includes('OR em.servidor_id <> v_servidor')],
  ['trg: um unico CREATE', () => (trg.split('CREATE OR REPLACE FUNCTION').length - 1) === 1],
  ['os dois usam o MESMO criterio de irmao', () => {
    const m = (t) => (t.match(/o\.mesclado_em_servidor_id IS NULL/g) || []).length
    return m(rpc) === 1 && m(trg) === 1
  }],
]
let falhou = false
for (const [nome, t] of inv) { const ok = t(); if (!ok) falhou = true; console.log(`${ok ? '  ok  ' : ' FALHA'}  ${nome}`) }
if (falhou) { console.error('\nABORTADO: invariante quebrado.'); process.exit(1) }

const cab = fs.readFileSync(path.join(__dirname, 'cab_pessoa_unica.txt'), 'utf8').replace(/\r\n/g, '\n')
const rod = fs.readFileSync(path.join(__dirname, 'rod_pessoa_unica.txt'), 'utf8').replace(/\r\n/g, '\n')
let saida = cab + '\n' + rpc + '\n\n' + trg + '\n' + rod
if (CRLF) saida = saida.replace(/\n/g, '\r\n')
fs.writeFileSync(DESTINO, saida)
console.log(`\ngerado: ${path.relative(RAIZ, DESTINO)}  (${saida.split(/\r?\n/).length} linhas)`)
