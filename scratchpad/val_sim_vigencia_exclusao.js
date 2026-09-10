/**
 * Valida o portao sim_vigencia_exclusao.js injetando regressoes de proposito.
 *
 * Um portao que nunca falha nao vale nada. Cada caso abaixo desfaz UMA das decisoes de
 * 10/09/2026; o portao tem que REPROVAR em todas.
 *
 * ⚠️ Cada injecao confere que a substituicao foi APLICADA antes de rodar o portao. Sem essa
 * conferencia, um replace que nao casa (indentacao diferente, CRLF) vira no-op e o validador
 * "passa" testando o codigo intacto - foi exatamente o que aconteceu em 03/09/2026 na arvore
 * de setores. Teste do teste que mente e pior que nao ter teste.
 *
 * Rodar:  node scratchpad/val_sim_vigencia_exclusao.js
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const RAIZ = path.resolve(__dirname, '..')
const MIGRATION = 'supabase/migrations/20260910100000_delete_vigencia_jornada_ato_registrado.sql'
const ACTIONS = 'src/app/(dashboard)/servidores/actions.ts'
const TELA = 'src/app/(dashboard)/servidores/[id]/ServidorDetalhesClient.tsx'

const REGRESSOES = [
  {
    nome: 'a exclusao volta a ser DELETE cru na tabela',
    arquivo: ACTIONS,
    de: `const { data, error } = await supabase.rpc('fn_excluir_vigencia_jornada', {
    p_vigencia_id: id,
    p_motivo: (motivo || '').trim(),
  })`,
    para: `const { data, error } = await supabase
    .from('servidores_jornadas_temporarias')
    .delete()
    .eq('id', id)`,
  },
  {
    nome: 'a trigger BEFORE DELETE some (o PostgREST volta a apagar direto)',
    arquivo: MIGRATION,
    de: 'BEFORE DELETE ON public.servidores_jornadas_temporarias\r\n    FOR EACH ROW EXECUTE FUNCTION public.trg_vigencia_jornada_exclusao_registrada();',
    para: 'BEFORE UPDATE ON public.servidores_jornadas_temporarias\r\n    FOR EACH ROW EXECUTE FUNCTION public.trg_vigencia_jornada_exclusao_registrada();',
  },
  {
    nome: 'a RPC deixa de conferir quem pode gerir a vigencia',
    arquivo: MIGRATION,
    de: 'IF NOT public.fn_pode_gerir_vigencia_jornada(v_vig.servidor_id) THEN',
    para: 'IF false THEN',
  },
  {
    nome: 'alguem "melhora" a RPC fazendo ela reconciliar sozinha',
    arquivo: MIGRATION,
    de: '    PERFORM set_config(\'sisescala.excluir_vigencia\', \'on\', true);',
    para: '    PERFORM set_config(\'sisescala.excluir_vigencia\', \'on\', true);\r\n    PERFORM public.fn_reconciliar_marcacoes_dia(v_vig.servidor_id, v_vig.data_inicio);',
  },
  {
    nome: 'o historico ganha policy de escrita',
    arquivo: MIGRATION,
    de: `CREATE POLICY "Autenticado ve historico de vigencia"
    ON public.servidores_jornadas_temporarias_historico
    FOR SELECT TO authenticated
    USING (true);`,
    para: `CREATE POLICY "Autenticado ve historico de vigencia"
    ON public.servidores_jornadas_temporarias_historico
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "Autenticado grava historico de vigencia"
    ON public.servidores_jornadas_temporarias_historico
    FOR INSERT TO authenticated
    WITH CHECK (true);`,
  },
  {
    // Esta regressao e a que o ensaio em homologacao descobriu: com o GUC ligado ate o fim da
    // transacao, um DELETE cru logo depois da RPC passava pela trigger.
    nome: 'o GUC deixa de ser desligado depois do DELETE',
    arquivo: MIGRATION,
    de: '\r\n\r\n    PERFORM set_config(\'sisescala.excluir_vigencia\', \'off\', true);',
    para: '',
  },
  {
    nome: 'o motivo da remocao deixa de ser exigido',
    arquivo: MIGRATION,
    de: 'IF length(v_motivo) < 5 THEN',
    para: 'IF false THEN',
  },
  {
    nome: 'a tela volta a confirmar sem mostrar o impacto',
    arquivo: TELA,
    de: 'motivoRemocao.trim().length < 5 ||',
    para: 'false ||',
  },
  {
    nome: 'calculateDuration perde o +1 (periodo de 1 dia vira "0 dias")',
    arquivo: TELA,
    de: 'const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1',
    para: 'const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))',
  },
]

function copiarPara(destino) {
  for (const rel of [MIGRATION, ACTIONS, TELA]) {
    const alvo = path.join(destino, rel)
    fs.mkdirSync(path.dirname(alvo), { recursive: true })
    fs.copyFileSync(path.join(RAIZ, rel), alvo)
  }
  // O portao varre src/ inteiro procurando DELETE cru; copiar so os tres arquivos basta,
  // porque a varredura anda sobre o que existir na copia.
}

/** Normaliza CRLF/LF dos dois lados: o repositorio usa CRLF nas migrations e LF no TS. */
function substituir(texto, de, para) {
  const alvos = [de, de.replace(/\r\n/g, '\n'), de.replace(/\n/g, '\r\n')]
  for (const alvo of alvos) {
    if (texto.includes(alvo)) {
      const casas = texto.split(alvo).length - 1
      return { texto: texto.split(alvo).join(para), casas }
    }
  }
  return { texto, casas: 0 }
}

let reprovouTodas = true
console.log(`\nInjetando ${REGRESSOES.length} regressoes; o portao tem que reprovar em todas.\n`)

for (const reg of REGRESSOES) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sisescala-val-'))
  copiarPara(tmp)

  const alvo = path.join(tmp, reg.arquivo)
  const original = fs.readFileSync(alvo, 'utf8')
  const { texto, casas } = substituir(original, reg.de, reg.para)

  if (casas === 0) {
    console.error(`  ERRO DE VALIDACAO: a injecao "${reg.nome}" NAO casou em ${reg.arquivo}.`)
    console.error('                     O portao seria rodado sobre codigo intacto - resultado sem valor.')
    reprovouTodas = false
    fs.rmSync(tmp, { recursive: true, force: true })
    continue
  }
  fs.writeFileSync(alvo, texto)

  let saiuComErro = false
  try {
    execFileSync(process.execPath, [path.join(RAIZ, 'scratchpad', 'sim_vigencia_exclusao.js')], {
      env: { ...process.env, SIM_RAIZ: tmp },
      stdio: 'pipe',
    })
  } catch {
    saiuComErro = true
  }

  if (saiuComErro) {
    console.log(`  ok  reprovou: ${reg.nome} (${casas} ocorrencia${casas === 1 ? '' : 's'})`)
  } else {
    console.error(`  FALHOU: o portao APROVOU com a regressao "${reg.nome}"`)
    reprovouTodas = false
  }

  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${'='.repeat(60)}`)
if (reprovouTodas) {
  console.log(`APROVADO: o portao reprovou as ${REGRESSOES.length} regressoes.`)
  process.exit(0)
} else {
  console.error('REPROVADO: o portao deixou passar pelo menos uma regressao.')
  process.exit(1)
}
