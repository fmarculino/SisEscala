// Gera os blocos de 20260911130000: mesclagem quando a IDENTIDADE diverge (o CPF nao bate).
//
// Copia MECANICAMENTE as duas funcoes vigentes e aplica substituicoes pontuais. Redigitar a mao
// e' exatamente como as seis regressoes da armadilha 1 aconteceram.
//
// ⚠️ FONTES VIGENTES, nao as de origem:
//   fn_impedimentos_mesclagem_servidor -> 20260906100000 (nasceu em 20260904130000)
//   fn_mesclar_servidores              -> 20260911120000 (passou por 20260904130000 e 20260906100000)
//
//   node scratchpad/gen_mesclagem_declarada.js
const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const F_IMP = path.join(RAIZ, 'supabase/migrations/20260906100000_mesclagem_funde_escala_do_mesmo_setor.sql')
const F_MESC = path.join(RAIZ, 'supabase/migrations/20260911120000_pendencias_de_cadastro_por_escopo.sql')

function abortar(msg) { console.error(`\n[ABORTADO] ${msg}`); process.exit(1) }

function lerFonte(arquivo) {
  const txt = fs.readFileSync(arquivo, 'utf8')
  // EOL DETECTADO, nunca assumido: padrao montado com o EOL errado vira no-op SILENCIOSO
  // (armadilhas 48 e 59). A convencao e' CRLF, mas ja houve migration em LF.
  return { txt, eol: txt.includes('\r\n') ? '\r\n' : '\n' }
}

function recortar(txt, marcador, arquivo) {
  const i = txt.indexOf(marcador)
  if (i < 0) abortar(`nao achei "${marcador.slice(0, 60)}" em ${path.basename(arquivo)}`)
  const d = txt.slice(i)
  const j = d.indexOf('$fn$;')
  if (j < 0) abortar(`nao achei o fechamento do dollar-quote de "${marcador.slice(0, 40)}"`)
  return d.slice(0, j + 5)
}

/** Substituicao que ABORTA se a contagem nao bater. E' o portao inteiro deste script. */
function trocar(corpo, nome, alvo, novo, esperado = 1) {
  const partes = corpo.split(alvo)
  const n = partes.length - 1
  if (n !== esperado) abortar(`substituicao "${nome}": esperava ${esperado} ocorrencia(s), achei ${n}`)
  console.log(`  [ed] ${nome} (${n})`)
  return partes.join(novo)
}

function conferir(corpo, lista, rotulo) {
  for (const [nome, re, esperado] of lista) {
    const n = (corpo.match(re) || []).length
    if (n === 0) abortar(`${rotulo}: invariante ausente — ${nome}`)
    if (esperado !== null && n !== esperado) {
      abortar(`${rotulo}: invariante "${nome}" — esperava ${esperado}, achei ${n}`)
    }
    console.log(`  [ok] ${nome} (${n})`)
  }
}

// ============================================================================
// 1. fn_impedimentos_mesclagem_servidor — ganha p_confirmar_identidade
// ============================================================================
const { txt: txtImp, eol: eolImp } = lerFonte(F_IMP)
console.log(`\nfonte impedimentos: ${path.basename(F_IMP)} (${eolImp === '\r\n' ? 'CRLF' : 'LF'})`)
let imp = recortar(txtImp, 'CREATE FUNCTION public.fn_impedimentos_mesclagem_servidor(', F_IMP)

console.log('invariantes ANTES (impedimentos):')
conferir(imp, [
  ['recusa por CPF divergente', /motivo := 'cpf_divergente';/g, 1],
  ['recusa quando nenhum dos dois tem CPF', /motivo := 'sem_cpf';/g, 1],
  ['escala sobreposta (armadilha 23 antes de criar o estado)', /motivo := 'escala_sobreposta';/g, 1],
  ['fusao de escala do mesmo setor', /fn_setor_caminho/g, null],
  ['varredura por pg_INDEX, nao pg_constraint', /pg_index/g, null],
  ['origem/destino ja mesclados', /origem_ja_mesclada|destino_ja_mesclado/g, 2],
], 'impedimentos')

imp = trocar(imp, 'assinatura ganha p_confirmar_identidade',
  'CREATE FUNCTION public.fn_impedimentos_mesclagem_servidor(' + eolImp +
  '    p_origem  uuid,' + eolImp +
  '    p_destino uuid' + eolImp +
  ')',
  'CREATE FUNCTION public.fn_impedimentos_mesclagem_servidor(' + eolImp +
  '    p_origem  uuid,' + eolImp +
  '    p_destino uuid,' + eolImp +
  '    -- Declaracao explicita de que os dois cadastros sao a mesma pessoa APESAR do CPF nao bater.' + eolImp +
  '    -- DEFAULT false de proposito: quem nao passa nada continua recebendo o impedimento, que e\'' + eolImp +
  '    -- o comportamento de sempre. O lado seguro e\' o default (armadilha 41).' + eolImp +
  '    p_confirmar_identidade boolean DEFAULT false' + eolImp +
  ')')

const ALVO_CPF = [
  '    -- CPF divergente: e o unico dado que diz que sao a MESMA pessoa. Sem ele nao ha mesclagem que',
  '    -- se possa desfazer depois - o ponto de uma teria virado ponto da outra.',
  '    IF v_o.cpf_norm IS NOT NULL AND v_d.cpf_norm IS NOT NULL',
  '       AND v_o.cpf_norm <> v_d.cpf_norm THEN',
  '        motivo := \'cpf_divergente\';',
  '        detalhe := \'Os dois cadastros tem CPF diferente. Se for a mesma pessoa, corrija o CPF \'',
  '                || \'errado na ficha antes de mesclar; se nao for, nao mescle.\';',
  '        RETURN NEXT;',
  '    END IF;',
].join(eolImp)

const NOVO_CPF = [
  '    -- CPF divergente. Continua sendo impedimento POR PADRAO: e\' o dado que diz que os dois',
  '    -- cadastros sao a mesma pessoa, e mesclar pessoas diferentes e\' o pior erro que esta',
  '    -- ferramenta comete (o ponto de uma vira ponto da outra, sem desfazer).',
  '    --',
  '    -- O QUE MUDOU EM 11/09/2026: existe caso real em que o CPF errado E\' o defeito — cadastro',
  '    -- refeito com o CPF de outra pessoa. Medido em producao: 1 grupo (SAMU-SMS), dois cadastros',
  '    -- criados com 25 min de diferenca no mesmo dia, mesma unidade, mesmo cargo, mesmo telefone.',
  '    -- A saida que o texto antigo mandava seguir era CIRCULAR: gravar na ficha o CPF do outro',
  '    -- cadastro exige marcar "vinculo adicional" em fn_cpf_ja_cadastrado, que e\' exatamente a',
  '    -- caixa cujo uso indevido cria a duplicata (armadilha 50). Nao havia caminho nenhum.',
  '    --',
  '    -- A declaracao NAO afrouxa nada alem disto: todos os outros impedimentos continuam, e a tela',
  '    -- mostra a identidade inteira divergente (fn_divergencias_identidade_servidor), nunca so o',
  '    -- CPF — no caso medido, PIS, data de nascimento e nome da mae tambem divergem, e quem so',
  '    -- visse "CPF diferente" decidiria sem o que importa.',
  '    IF v_o.cpf_norm IS NOT NULL AND v_d.cpf_norm IS NOT NULL',
  '       AND v_o.cpf_norm <> v_d.cpf_norm AND NOT COALESCE(p_confirmar_identidade, false) THEN',
  '        motivo := \'cpf_divergente\';',
  '        detalhe := \'Os dois cadastros tem CPF diferente. Se for a mesma pessoa com um CPF \'',
  '                || \'cadastrado errado, use a mesclagem com identidade declarada; se nao for a \'',
  '                || \'mesma pessoa, nao mescle.\';',
  '        RETURN NEXT;',
  '    END IF;',
].join(eolImp)

imp = trocar(imp, 'cpf_divergente respeita a declaracao', ALVO_CPF, NOVO_CPF)

console.log('invariantes DEPOIS (impedimentos):')
conferir(imp, [
  ['sem_cpf continua DURO (nao ha caso medido para afrouxar)', /motivo := 'sem_cpf';/g, 1],
  ['escala sobreposta intacta', /motivo := 'escala_sobreposta';/g, 1],
  ['a declaracao so alcanca o cpf_divergente', /p_confirmar_identidade/g, 2],
], 'impedimentos')

// o sem_cpf nao pode ter ganhado a escotilha por descuido de copia
const trechoSemCpf = imp.slice(imp.indexOf("motivo := 'sem_cpf';") - 400, imp.indexOf("motivo := 'sem_cpf';"))
if (trechoSemCpf.includes('p_confirmar_identidade')) {
  abortar('a declaracao vazou para o impedimento sem_cpf — sem CPF nos dois lados nao ha o que declarar')
}
console.log('  [ok] sem_cpf ficou fora da escotilha')

// ============================================================================
// 2. fn_mesclar_servidores — ganha p_confirmar_identidade
// ============================================================================
const { txt: txtMesc, eol } = lerFonte(F_MESC)
console.log(`\nfonte mesclagem: ${path.basename(F_MESC)} (${eol === '\r\n' ? 'CRLF' : 'LF'})`)
if (eol !== eolImp) abortar('as duas fontes tem EOL diferente')
let mesc = recortar(txtMesc, 'CREATE OR REPLACE FUNCTION public.fn_mesclar_servidores(', F_MESC)

console.log('invariantes ANTES (mesclagem):')
conferir(mesc, [
  ['guard de papel (RH Geral + Administrador Geral)', /NOT IN \('super_admin'::public\.user_role,/g, 1],
  ['GUC que destrava a imutabilidade da marcacao', /sisescala\.mesclar_servidor/g, null],
  ['allowlist de campos de pessoa', /c_campos_pessoa/g, 2],
  ['varredura por pg_INDEX, nao pg_constraint', /pg_index/g, null],
  ['impedimentos consultados antes de escrever', /fn_impedimentos_mesclagem_servidor\(p_origem, p_destino\)/g, 1],
  ['fusao de escala ANTES do laco generico', /6\.0 Escala do mesmo servidor/g, 1],
  ['inativa em vez de excluir', /mesclado_em_servidor_id = p_destino/g, 1],
  ['log do ato', /cadastro_servidor_mesclado/g, 1],
], 'mesclagem')

mesc = trocar(mesc, 'assinatura ganha p_confirmar_identidade',
  'CREATE OR REPLACE FUNCTION public.fn_mesclar_servidores(' + eol +
  '    p_origem  uuid,' + eol +
  '    p_destino uuid,' + eol +
  '    p_motivo  text DEFAULT NULL' + eol +
  ')',
  'CREATE OR REPLACE FUNCTION public.fn_mesclar_servidores(' + eol +
  '    p_origem  uuid,' + eol +
  '    p_destino uuid,' + eol +
  '    p_motivo  text DEFAULT NULL,' + eol +
  '    -- "Sao a mesma pessoa, apesar do CPF nao bater." DEFAULT false: quem nao declara nada' + eol +
  '    -- continua barrado, como sempre foi.' + eol +
  '    p_confirmar_identidade boolean DEFAULT false' + eol +
  ')')

mesc = trocar(mesc, 'variaveis da declaracao',
  '    v_restantes   bigint;' + eol + 'BEGIN',
  '    v_restantes   bigint;' + eol +
  '    -- Declaracao EFETIVA: o chamador pediu E o CPF de fato diverge. Sem esta conjuncao,' + eol +
  '    -- p_confirmar_identidade viraria uma chave que muda o comportamento de toda mesclagem —' + eol +
  '    -- inclusive as normais, onde ela nao tem nada a autorizar.' + eol +
  '    v_declarada   boolean := false;' + eol +
  '    v_divergentes text[] := ARRAY[]::text[];' + eol + 'BEGIN')

mesc = trocar(mesc, 'divergencia de identidade + motivo obrigatorio',
  '    -- Todos os impedimentos de uma vez: quem esta na tela precisa ver a lista inteira, nao' + eol +
  '    -- descobrir um por vez a cada tentativa.' + eol +
  '    SELECT string_agg(imp.detalhe, \' | \')' + eol +
  '      INTO v_impedimento' + eol +
  '      FROM public.fn_impedimentos_mesclagem_servidor(p_origem, p_destino) imp;',

  '    -- A identidade inteira que diverge entre os dois cadastros (CPF, PIS, nascimento, nome da' + eol +
  '    -- mae...). Calculada SEMPRE: e\' o que vai para o log do ato e para o relato da tela.' + eol +
  '    SELECT COALESCE(array_agg(dv.rotulo ORDER BY dv.campo), ARRAY[]::text[])' + eol +
  '      INTO v_divergentes' + eol +
  '      FROM public.fn_divergencias_identidade_servidor(p_origem, p_destino) dv;' + eol +
  '' + eol +
  '    v_declarada := COALESCE(p_confirmar_identidade, false)' + eol +
  '                   AND v_o.cpf_norm IS NOT NULL AND v_d.cpf_norm IS NOT NULL' + eol +
  '                   AND v_o.cpf_norm <> v_d.cpf_norm;' + eol +
  '' + eol +
  '    -- Motivo OBRIGATORIO aqui, opcional no resto. Nas outras mesclagens o CPF igual e\' a prova;' + eol +
  '    -- nesta, a unica prova que vai existir e\' o que a pessoa escreveu. Sem texto, o log' + eol +
  '    -- registraria que alguem juntou dois cadastros de identidade diferente e mais nada.' + eol +
  '    --' + eol +
  '    -- ⚠️ RAISE exige LITERAL, nao expressao: \'texto \' || \'mais texto\' da 42601 aqui (e so na' + eol +
  '    -- execucao do CREATE, nunca no build). Por isso a mensagem vai numa linha so.' + eol +
  '    IF v_declarada AND length(btrim(regexp_replace(COALESCE(p_motivo, \'\'), \'\\s+\', \' \', \'g\'))) < 10 THEN' + eol +
  '        RAISE EXCEPTION \'Mesclagem com CPF diferente exige o motivo escrito (ao menos 10 caracteres): diga por que os dois cadastros sao a mesma pessoa.\'' + eol +
  '            USING ERRCODE = \'check_violation\';' + eol +
  '    END IF;' + eol +
  '' + eol +
  '    -- Todos os impedimentos de uma vez: quem esta na tela precisa ver a lista inteira, nao' + eol +
  '    -- descobrir um por vez a cada tentativa.' + eol +
  '    SELECT string_agg(imp.detalhe, \' | \')' + eol +
  '      INTO v_impedimento' + eol +
  '      FROM public.fn_impedimentos_mesclagem_servidor(p_origem, p_destino, p_confirmar_identidade) imp;')

mesc = trocar(mesc, 'identidade declarada NAO completa campo de pessoa',
  '    FOREACH v_campo IN ARRAY c_campos_pessoa LOOP',
  '    -- COM IDENTIDADE DECLARADA, NAO COMPLETA NADA. Nas mesclagens normais o CPF igual prova que' + eol +
  '    -- os dois cadastros descrevem a mesma pessoa, e completar um campo vazio do que fica e\' ganho' + eol +
  '    -- puro. Aqui nao ha essa prova: no caso que motivou, o cadastro duplicado trazia PIS, data de' + eol +
  '    -- nascimento e nome da mae de OUTRA pessoa. Copiar isso para a ficha que fica contaminaria o' + eol +
  '    -- cadastro correto com dado de terceiro — e em silencio, porque so alcanca campo VAZIO, que' + eol +
  '    -- e\' justamente onde ninguem olha. Mover vinculo e inativar o duplicado e\' tudo que esta' + eol +
  '    -- operacao precisa fazer.' + eol +
  '    FOREACH v_campo IN ARRAY (CASE WHEN v_declarada THEN ARRAY[]::text[] ELSE c_campos_pessoa END) LOOP')

mesc = trocar(mesc, 'motivo da inativacao registra a declaracao',
  '               format(\'Cadastro duplicado - mesclado na matricula %s.%s\',' + eol +
  '                      v_d.matricula,',
  '               format(\'Cadastro duplicado - mesclado na matricula %s.%s%s\',' + eol +
  '                      v_d.matricula,' + eol +
  '                      CASE WHEN v_declarada' + eol +
  '                           THEN format(\' Identidade declarada pelo responsavel apesar de \'' + eol +
  '                                    || \'divergencia em: %s.\', array_to_string(v_divergentes, \', \'))' + eol +
  '                           ELSE \'\' END,')

mesc = trocar(mesc, 'log registra a declaracao',
  '        \'vinculo_multiplo_reavaliado\', v_restantes = 0' + eol + '    ));',
  '        \'vinculo_multiplo_reavaliado\', v_restantes = 0,' + eol +
  '        \'identidade_declarada\', v_declarada,' + eol +
  '        \'identidade_divergente\', to_jsonb(v_divergentes)' + eol + '    ));')

mesc = trocar(mesc, 'retorno relata a declaracao',
  '        \'escalas_fundidas\', v_fundidas,' + eol +
  '        \'message\', format(\'Cadastro %s mesclado na matricula %s.\', v_o.matricula, v_d.matricula));',
  '        \'escalas_fundidas\', v_fundidas,' + eol +
  '        \'identidade_declarada\', v_declarada,' + eol +
  '        \'identidade_divergente\', to_jsonb(v_divergentes),' + eol +
  '        \'message\', format(\'Cadastro %s mesclado na matricula %s.\', v_o.matricula, v_d.matricula));')

console.log('invariantes DEPOIS (mesclagem):')
conferir(mesc, [
  ['guard de papel intacto', /NOT IN \('super_admin'::public\.user_role,/g, 1],
  ['GUC da imutabilidade intacto', /sisescala\.mesclar_servidor/g, null],
  ['varredura por pg_INDEX intacta', /pg_index/g, null],
  ['fusao de escala ainda ANTES do laco generico', /6\.0 Escala do mesmo servidor/g, 1],
  ['inativa em vez de excluir', /mesclado_em_servidor_id = p_destino/g, 1],
  ['impedimentos recebem a declaracao', /fn_impedimentos_mesclagem_servidor\(p_origem, p_destino, p_confirmar_identidade\)/g, 1],
  ['motivo obrigatorio quando declarada', /Mesclagem com CPF diferente exige o motivo escrito/g, 1],
  ['declaracao EFETIVA exige CPF divergente de fato', /v_declarada := COALESCE\(p_confirmar_identidade, false\)/g, 1],
  ['campo de pessoa nao e copiado na declarada', /CASE WHEN v_declarada THEN ARRAY\[\]::text\[\] ELSE c_campos_pessoa END/g, 1],
], 'mesclagem')

// A ordem importa: a fusao de escala (6.0) tem que continuar ANTES do laco generico de FKs, senao
// a unique de escala_mensal derruba a transacao inteira (armadilha registrada na 20260906100000).
const posFusao = mesc.indexOf('6.0 Escala do mesmo servidor')
const posLaco = mesc.indexOf('FOR r IN')
if (posFusao < 0 || posLaco < 0 || posFusao > posLaco) {
  abortar('a fusao de escala deixou de vir antes do laco generico de FKs')
}
console.log('  [ok] ordem preservada: fusao de escala antes do laco generico')

fs.writeFileSync(path.join(__dirname, '_imp_gerada.sql'), imp)
fs.writeFileSync(path.join(__dirname, '_mesc_gerada.sql'), mesc)
console.log('\n[ok] blocos gerados: scratchpad/_imp_gerada.sql e scratchpad/_mesc_gerada.sql')
