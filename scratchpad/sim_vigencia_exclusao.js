/**
 * Portao: remover vigencia de jornada e ATO REGISTRADO, nunca um DELETE.
 *
 * Nao ha framework de teste no projeto, e o grosso da regra aqui vive em SQL que nao roda
 * localmente. Entao este portao e um scanner estrutural, no mesmo espirito de
 * sim_rep_fila_dono.js: ele reprova o codigo que desfaz cada decisao tomada em 10/09/2026.
 *
 * As decisoes que ele defende, e por que cada uma:
 *
 *   1. NAO existe DELETE cru em servidores_jornadas_temporarias em lugar nenhum de src/.
 *      Era exatamente esse o buraco: sem motivo, sem rastro, sem guard.
 *   2. A trigger BEFORE DELETE existe. Sem ela, a tela corrigida nao protege quem chama o
 *      PostgREST direto (armadilha 12: tela filtrada nao protege a RPC).
 *   3. A RPC confere fn_pode_gerir_vigencia_jornada explicitamente. SECURITY DEFINER passa por
 *      cima da RLS, entao a policy de DELETE nao roda mais.
 *   4. A RPC NAO reconcilia nem sincroniza. Reconciliar em massa esta medido e recusado
 *      (4 ganhos contra 43 trocas e 7 perdas). Se alguem "melhorar" isso, o portao reprova.
 *   5. O historico nao tem policy de escrita - so a RPC SECURITY DEFINER grava nele.
 *   6. O aviso da tela mostra a JANELA (jornada_apos), nao um total de horas: em 97 dos 115
 *      dias medidos a carga era identica e so a janela deslocava.
 *   7. calculateDuration soma +1: as datas da vigencia sao inclusivas nos dois extremos.
 *   8. #variable_conflict use_column na funcao RETURNS TABLE (armadilha 42).
 *
 * Rodar:  node scratchpad/sim_vigencia_exclusao.js
 */

const fs = require('fs')
const path = require('path')

// SIM_RAIZ existe para o validador (val_sim_vigencia_exclusao.js) rodar este portao sobre uma
// COPIA com regressao injetada, sem nunca tocar no repositorio de verdade.
const RAIZ = process.env.SIM_RAIZ ? path.resolve(process.env.SIM_RAIZ) : path.resolve(__dirname, '..')
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8')

const MIGRATION = 'supabase/migrations/20260910100000_delete_vigencia_jornada_ato_registrado.sql'
const ACTIONS = 'src/app/(dashboard)/servidores/actions.ts'
const TELA = 'src/app/(dashboard)/servidores/[id]/ServidorDetalhesClient.tsx'

let falhas = 0
let passou = 0

function ok(condicao, descricao, detalhe) {
  if (condicao) {
    passou++
  } else {
    falhas++
    console.error(`  REPROVADO: ${descricao}${detalhe ? `\n              ${detalhe}` : ''}`)
  }
}

/** Varre src/ inteiro, porque o defeito volta por um arquivo novo, nao pelo que ja foi corrigido. */
function arquivosTs(dir, acc = []) {
  for (const nome of fs.readdirSync(path.join(RAIZ, dir))) {
    const rel = `${dir}/${nome}`
    const st = fs.statSync(path.join(RAIZ, rel))
    if (st.isDirectory()) arquivosTs(rel, acc)
    else if (/\.tsx?$/.test(nome)) acc.push(rel)
  }
  return acc
}

console.log('\n== 1. Nenhum DELETE cru em servidores_jornadas_temporarias ==')
{
  // Casa .from('servidores_jornadas_temporarias') seguido de .delete() dentro da mesma cadeia,
  // com quebras de linha no meio (que e como o codigo original era escrito).
  const padrao = /from\(\s*['"]servidores_jornadas_temporarias['"]\s*\)[\s\S]{0,200}?\.delete\s*\(/
  const culpados = arquivosTs('src').filter((f) => padrao.test(ler(f)))
  ok(
    culpados.length === 0,
    'nenhum arquivo de src/ apaga a vigencia direto pela tabela',
    culpados.length ? `apagam direto: ${culpados.join(', ')}` : ''
  )

  const actions = ler(ACTIONS)
  ok(
    /fn_excluir_vigencia_jornada/.test(actions),
    'deleteJornadaTemporaria passa pela RPC fn_excluir_vigencia_jornada'
  )
  ok(
    /export async function deleteJornadaTemporaria\([^)]*motivo/.test(actions),
    'deleteJornadaTemporaria recebe o motivo (sem ele nao ha rastro do que foi desfeito)'
  )
  ok(
    /export async function getImpactoVigenciaJornada/.test(actions),
    'existe a action que pergunta o impacto ao banco antes de remover'
  )
}

console.log('\n== 2. A rede de seguranca no banco ==')
{
  const sql = ler(MIGRATION)

  ok(
    /CREATE TRIGGER trg_vigencia_jornada_exclusao_registrada[\s\S]{0,200}BEFORE DELETE ON public\.servidores_jornadas_temporarias/.test(sql),
    'existe trigger BEFORE DELETE em servidores_jornadas_temporarias'
  )
  ok(
    /current_setting\('sisescala\.excluir_vigencia'/.test(sql),
    'a trigger e destravada por GUC local a transacao, nao por papel'
  )
  ok(
    /set_config\('sisescala\.excluir_vigencia',\s*'on',\s*true\)/.test(sql),
    'a RPC seta o GUC como LOCAL (terceiro argumento true) - senao ele vaza para a sessao'
  )
  // Medido no ensaio em homologacao (10/09/2026): "local a transacao" e ate o fim DA
  // TRANSACAO, nao da funcao. Sem o desligamento, um DELETE cru na mesma transacao passava
  // direto pela trigger - a janela precisa durar exatamente um statement.
  ok(
    /DELETE FROM public\.servidores_jornadas_temporarias WHERE id = p_vigencia_id;\s*\r?\n\s*PERFORM set_config\('sisescala\.excluir_vigencia',\s*'off',\s*true\)/.test(sql),
    'o GUC e desligado LOGO APOS o DELETE (senao ele autoriza o resto da transacao)'
  )
  ok(
    /fn_pode_gerir_vigencia_jornada\(v_vig\.servidor_id\)/.test(sql),
    'a RPC confere fn_pode_gerir_vigencia_jornada explicitamente (SECURITY DEFINER ignora a RLS)'
  )
  ok(
    /length\(v_motivo\)\s*<\s*5/.test(sql),
    'a RPC exige motivo com ao menos 5 caracteres'
  )
  ok(
    /#variable_conflict use_column/.test(sql),
    'a funcao RETURNS TABLE declara #variable_conflict use_column (armadilha 42)'
  )
}

console.log('\n== 3. A RPC nao reconcilia nem sincroniza ==')
{
  const sql = ler(MIGRATION)
  // Fora dos comentarios: linha de codigo que chame reconciliacao/reparse.
  const semComentario = sql
    .split(/\r?\n/)
    .filter((l) => !/^\s*--/.test(l))
    .join('\n')
  ok(
    !/fn_reconciliar_marcacoes_dia|fn_alocar_marcacoes_dia|fn_reparse_afd/.test(semComentario),
    'a migration nao dispara reconciliacao (medido: 4 ganhos contra 43 trocas e 7 perdas)'
  )
  ok(
    !/UPDATE\s+public\.folha_ponto|UPDATE\s+public\.escala_diaria/.test(semComentario),
    'a migration nao escreve em folha_ponto nem em escala_diaria'
  )
  ok(
    /dias_a_revisar/.test(sql),
    'a RPC devolve os dias afetados para uma pessoa decidir'
  )
}

console.log('\n== 4. Historico append-only e sem policy de escrita ==')
{
  const sql = ler(MIGRATION)
  ok(
    /CREATE TABLE IF NOT EXISTS public\.servidores_jornadas_temporarias_historico/.test(sql),
    'a tabela de historico e criada'
  )
  ok(
    /BEFORE UPDATE OR DELETE ON public\.servidores_jornadas_temporarias_historico/.test(sql),
    'o historico tem trava de append-only'
  )
  const policies = sql.match(/CREATE POLICY[\s\S]*?ON public\.servidores_jornadas_temporarias_historico[\s\S]*?FOR (\w+)/g) || []
  const escrita = policies.filter((p) => !/FOR SELECT/.test(p))
  ok(
    escrita.length === 0,
    'o historico nao ganhou policy de escrita (so a RPC SECURITY DEFINER grava)',
    escrita.length ? `policies de escrita: ${escrita.length}` : ''
  )
  ok(
    /motivo_exclusao\s+text NOT NULL/.test(sql),
    'motivo_exclusao e NOT NULL no historico'
  )
}

console.log('\n== 5. Privilegios (armadilha 24) ==')
{
  const sql = ler(MIGRATION)
  for (const fn of ['fn_vigencia_jornada_impacto', 'fn_excluir_vigencia_jornada']) {
    ok(
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC`).test(sql),
      `${fn} tem REVOKE FROM PUBLIC`
    )
    ok(
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO authenticated`).test(sql),
      `${fn} mantem EXECUTE para authenticated (revogar demais derruba a ficha do servidor)`
    )
  }
  ok(
    /has_function_privilege\('anon'/.test(sql) && /RAISE EXCEPTION 'anon ainda executa/.test(sql),
    'a migration confere o proprio resultado e aborta se anon continuar entrando'
  )
}

console.log('\n== 6. A tela avisa com a JANELA, nao com horas ==')
{
  const tela = ler(TELA)
  ok(
    /getImpactoVigenciaJornada/.test(tela),
    'a tela pergunta o impacto ao banco antes de abrir a confirmacao'
  )
  ok(
    /impacto\.jornada_apos/.test(tela),
    'o aviso mostra para onde o horario previsto volta (a janela de -> para)'
  )
  ok(
    /impacto\.dias_com_ponto/.test(tela),
    'o aviso mostra quantos dias ja tem ponto'
  )
  ok(
    /motivoRemocao\.trim\(\)\.length\s*<\s*5/.test(tela),
    'o botao de confirmar so libera com motivo de 5 caracteres'
  )
  ok(
    /impacto\.impedimento/.test(tela),
    'quando o banco recusa, o motivo sai escrito na tela (botao cinza sem explicacao ensina a contornar)'
  )
  ok(
    !/deleteJornadaTemporaria\(\s*[A-Za-z0-9_.]+\s*,\s*id\s*\)/.test(tela),
    'nenhuma chamada de remocao ficou com a assinatura antiga (sem motivo)'
  )
}

console.log('\n== 7. Duracao com datas inclusivas ==')
{
  const tela = ler(TELA)
  ok(/const calculateDuration/.test(tela), 'calculateDuration continua existindo')
  const linhaDiff = tela.split(/\r?\n/).find((l) => /const diffDays\s*=/.test(l)) || ''
  ok(
    /\+\s*1\s*$/.test(linhaDiff.trim()),
    'calculateDuration soma +1 (as datas da vigencia sao inclusivas nos dois extremos)',
    `sem o +1, um periodo de 29/09 a 29/09 aparece como "0 dias". Linha lida: ${linhaDiff.trim() || '(nao encontrada)'}`
  )
}

console.log(`\n${'='.repeat(60)}`)
if (falhas === 0) {
  console.log(`APROVADO: ${passou} assercoes.`)
  process.exit(0)
} else {
  console.error(`REPROVADO: ${falhas} de ${passou + falhas} assercoes.`)
  process.exit(1)
}
