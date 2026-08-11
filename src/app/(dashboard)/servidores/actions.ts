'use server'

import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { registrarLog, calcularAlteracoes } from '@/utils/auditoria'
import { erroDocumento, normalizarDoc } from '@/utils/documentos'

const normalizarCpf = (cpf?: string | null) => (cpf || '').replace(/\D/g, '')

/**
 * Recusa CPF e PIS com dígito verificador inválido.
 *
 * POR QUE AQUI, se o formulário já avisa e o banco vai ter `CHECK`
 *   O aviso do formulário é só informativo — ele não bloqueia o submit de propósito. E a action é
 *   chamável direto, sem passar por tela nenhuma: foi por essa porta que o Portal do Servidor
 *   editava a folha de ponto mesmo com o input desabilitado (v1.23.0). A importação de CSV
 *   também não passa por formulário algum.
 *
 * O `CHECK` do banco (20260809230000) é a garantia final, mas ele devolve erro de Postgres. Esta
 * camada existe para a pessoa saber **qual campo** está errado.
 *
 * Campo vazio nunca é erro: 57 servidores estão sem CPF e nenhum destes documentos é obrigatório.
 */
function validarDocumentosServidor(cpf?: string | null, pis?: string | null): string | null {
  return erroDocumento(cpf, 'cpf') || erroDocumento(pis, 'pis')
}

/**
 * Confere se o CPF já pertence a outro cadastro — e, desde 20260810140000, permite que seja
 * um vínculo adicional legítimo (a mesma pessoa com dois cargos/matrículas), não erro.
 *
 * Passa pela RPC de propósito. Um `.from('servidores').eq('cpf', ...)` daqui usaria o cliente do
 * usuário logado e cairia na policy "Users can view relevant servers", que escopa por
 * unidade/setor — quem não enxerga a outra unidade não acha a duplicata e cadastra de novo.
 * É a mesma causa raiz da colisão de matrícula corrigida em 20260807110000, e foi assim que
 * VIVIAN MARTINS MACEDO acabou com dois cadastros (T2600019 e T2600014) em produção.
 *
 * `fn_cpf_ja_cadastrado` é SECURITY DEFINER e enxerga a tabela inteira.
 *
 * ⚠️ Não há mais índice único de banco atrás disto (20260810140000 derrubou
 * `servidores_cpf_unico`): o relatório de RH de 09/2026 mostrou 110 CPFs com dois vínculos ativos
 * simultâneos de verdade (mesma pessoa, matrícula e cargo diferentes) — um índice único bloquearia
 * esses casos legítimos. A troca foi consciente (ver cabeçalho da migration): esta checagem deixou
 * de ser só mensagem amigável e passou a ser o único portão. Sem `confirmaVinculoAdicional`, o
 * comportamento continua o mesmo de antes (recusa); só muda quando o chamador confirma
 * explicitamente.
 */
async function verificarCpfDuplicado(
  supabase: any,
  cpf: string | null | undefined,
  ignorarId?: string,
  confirmaVinculoAdicional: boolean = false
): Promise<{ erro: string | null; vinculoMultiplo: boolean }> {
  const limpo = normalizarCpf(cpf)
  if (!limpo) return { erro: null, vinculoMultiplo: false }

  const { data, error } = await supabase.rpc('fn_cpf_ja_cadastrado', {
    p_cpf: limpo,
    p_ignorar_id: ignorarId || null,
  })

  // Falha de rede/RPC: sem índice único de banco atrás, uma duplicata pode passar. Prefere isto a
  // travar o cadastro por instabilidade de rede — o diagnóstico (/servidores/pendencias) pega depois.
  if (error) {
    console.warn('Falha ao verificar CPF duplicado (sem backstop de banco — ver 20260810140000):', error.message)
    return { erro: null, vinculoMultiplo: false }
  }

  const encontrado = Array.isArray(data) ? data[0] : data
  if (!encontrado) return { erro: null, vinculoMultiplo: false }

  if (confirmaVinculoAdicional) {
    return { erro: null, vinculoMultiplo: true }
  }

  const onde = encontrado.unidade_nome ? ` na unidade ${encontrado.unidade_nome}` : ''
  return {
    erro: `Este CPF já está cadastrado para ${encontrado.nome} (matrícula ${encontrado.matricula})${onde}. ` +
      `Se for a mesma pessoa com um cadastro por engano, transfira o cadastro existente em vez de criar outro. ` +
      `Se for a mesma pessoa com um SEGUNDO vínculo de verdade (outro cargo, outra escala), marque a confirmação de vínculo adicional.`,
    vinculoMultiplo: false,
  }
}

/**
 * Recusa uma lotação que a RLS não deixaria gravar, com mensagem em vez de erro de Postgres.
 *
 * A policy "Scoped access for Admins and Coordinators" (20260618080000) foi criada `FOR ALL` sem
 * `WITH CHECK` — nesse caso o Postgres reusa a expressão do `USING` como `WITH CHECK`. Para quem
 * não tem `acesso_todas_unidades` nem `acesso_todos_setores` (20 dos 30 perfis de produção), a
 * única via que autoriza é `setor_id IN profile_setores`. Logo:
 *
 *   - gravar setor NULL é sempre recusado, porque NULL não pertence a lista nenhuma;
 *   - gravar setor de outro escopo é recusado do mesmo jeito.
 *
 * Em 10/08/2026 a Suemilly (admin, escopo = DMAC) tentou deixar a KETTELE "Disponibilizada para
 * RH" mudando o setor para "Sem Setor" e recebeu na tela o texto cru
 * `new row violates row-level security policy for table "servidores"`.
 *
 * POR QUE BLOQUEAR EM VEZ DE ABRIR A POLICY
 *   Servidor sem setor sairia do escopo de quem o soltou: a linha passaria a reprovar também no
 *   `USING`, e nem ela nem nenhum outro admin escopado conseguiria editar o cadastro de novo — só
 *   super_admin. Não há um único servidor sem setor em produção hoje; a lotação é o que sustenta
 *   escala e folha de ponto.
 *
 * Roda no servidor, e não só no formulário, porque a action é chamável direto — mesma razão de
 * `validarDocumentosServidor`.
 */
async function validarLotacaoNoEscopo(
  supabase: any,
  setorId: string | null
): Promise<string | null> {
  if (!setorId) {
    return 'Selecione o setor de lotação. Um servidor sem setor sai das escalas e da folha de ponto, ' +
      'e deixa de ser editável por quem administra o setor de origem. Para afastar alguém da equipe, ' +
      'transfira para o setor de destino ou inative o cadastro informando o motivo.'
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, acesso_todas_unidades, acesso_todos_setores, profile_setores(setor_id)')
    .eq('id', user.id)
    .single()

  // Sem perfil legível não dá para concluir nada: deixa a RLS decidir, que é a garantia final.
  if (error || !profile) return null

  if (profile.role === 'super_admin' || profile.acesso_todas_unidades || profile.acesso_todos_setores) {
    return null
  }

  const permitidos = (profile.profile_setores || []).map((ps: any) => ps.setor_id)
  if (permitidos.includes(setorId)) return null

  return 'Você não tem permissão para lotar um servidor neste setor. Só é possível gravar nos setores ' +
    'vinculados ao seu perfil — peça a um administrador para vincular o setor de destino ao seu acesso ' +
    'ou para realizar a transferência.'
}

/**
 * Registra uma transferência já EFETIVADA (o `UPDATE` de `unidade_id`/`setor_id` em `servidores`
 * já rodou antes de chamar isto): grava `historico_transferencias` e limpa escala conflitante nos
 * dois lados. Compartilhado por dois chamadores — `updateServidor` (transferência direta do
 * super_admin) e `avaliarSolicitacaoTransferencia` (aprovação de um pedido) — pra não ter duas
 * cópias da limpeza de escala divergindo com o tempo (armadilha 1 do CLAUDE.md, mesmo raciocínio
 * de "uma função, um lugar", só que em TS em vez de SQL).
 */
async function registrarTransferenciaEfetivada(supabase: any, params: {
  servidorId: string
  unidadeOrigemId: string | null
  setorOrigemId: string | null
  unidadeDestinoId: string | null
  setorDestinoId: string | null
  dataTransferencia: string
  motivo: string
  criadoPorId: string | null
}): Promise<{ error?: string; historicoId?: string }> {
  const { servidorId, unidadeOrigemId, setorOrigemId, unidadeDestinoId, setorDestinoId, dataTransferencia, motivo, criadoPorId } = params

  const { data: histRow, error: histError } = await supabase
    .from('historico_transferencias')
    .insert({
      servidor_id: servidorId,
      unidade_origem_id: unidadeOrigemId,
      setor_origem_id: setorOrigemId,
      unidade_destino_id: unidadeDestinoId,
      setor_destino_id: setorDestinoId,
      data_transferencia: dataTransferencia,
      motivo,
      criado_por_id: criadoPorId,
    })
    .select('id')
    .single()

  if (histError) {
    return { error: `Erro ao salvar histórico de transferência: ${histError.message}` }
  }

  // Limpa turnos concorrentes nos dois setores para o mês/ano da transferência e períodos
  // subsequentes/precedentes. Best-effort: falha aqui não desfaz a transferência, só loga.
  try {
    const dateParts = dataTransferencia.split('-')
    const transferYear = parseInt(dateParts[0], 10)
    const transferMonth = parseInt(dateParts[1], 10)
    const transferDay = parseInt(dateParts[2], 10)

    if (!isNaN(transferYear) && !isNaN(transferMonth) && !isNaN(transferDay)) {
      // A. Origin Scale (Transfer Month): Clear shifts on and after the transfer day (without presence)
      if (unidadeOrigemId && setorOrigemId) {
        const { data: originScale } = await supabase
          .from('escala_mensal')
          .select('id')
          .eq('servidor_id', servidorId)
          .eq('unidade_id', unidadeOrigemId)
          .eq('setor_id', setorOrigemId)
          .eq('mes', transferMonth)
          .eq('ano', transferYear)
          .maybeSingle()

        if (originScale) {
          await supabase
            .from('escala_diaria')
            .delete()
            .eq('escala_mensal_id', originScale.id)
            .gte('dia', transferDay)
            .is('presenca_entrada_em', null)
            .is('presenca_saida_em', null)
        }
      }

      // B. Destination Scale (Transfer Month): Clear shifts before the transfer day (without presence)
      if (unidadeDestinoId && setorDestinoId) {
        const { data: destScale } = await supabase
          .from('escala_mensal')
          .select('id')
          .eq('servidor_id', servidorId)
          .eq('unidade_id', unidadeDestinoId)
          .eq('setor_id', setorDestinoId)
          .eq('mes', transferMonth)
          .eq('ano', transferYear)
          .maybeSingle()

        if (destScale) {
          await supabase
            .from('escala_diaria')
            .delete()
            .eq('escala_mensal_id', destScale.id)
            .lt('dia', transferDay)
            .is('presenca_entrada_em', null)
            .is('presenca_saida_em', null)
        }
      }

      // C. Subsequent Months (Origin Sector): Delete all monthly scales and daily shifts without presence
      if (unidadeOrigemId && setorOrigemId) {
        const { data: futureOriginScales } = await supabase
          .from('escala_mensal')
          .select('id, mes, ano')
          .eq('servidor_id', servidorId)
          .eq('unidade_id', unidadeOrigemId)
          .eq('setor_id', setorOrigemId)

        if (futureOriginScales) {
          const futureScaleIds = futureOriginScales
            .filter((em: any) => em.ano > transferYear || (em.ano === transferYear && em.mes > transferMonth))
            .map((em: any) => em.id)

          if (futureScaleIds.length > 0) {
            await supabase
              .from('escala_diaria')
              .delete()
              .in('escala_mensal_id', futureScaleIds)
              .is('presenca_entrada_em', null)
              .is('presenca_saida_em', null)

            await supabase
              .from('escala_mensal')
              .delete()
              .in('id', futureScaleIds)
          }
        }
      }

      // D. Preceding Months (Destination Sector): Delete any monthly scales and daily shifts without presence
      if (unidadeDestinoId && setorDestinoId) {
        const { data: pastDestScales } = await supabase
          .from('escala_mensal')
          .select('id, mes, ano')
          .eq('servidor_id', servidorId)
          .eq('unidade_id', unidadeDestinoId)
          .eq('setor_id', setorDestinoId)

        if (pastDestScales) {
          const pastScaleIds = pastDestScales
            .filter((em: any) => em.ano < transferYear || (em.ano === transferYear && em.mes < transferMonth))
            .map((em: any) => em.id)

          if (pastScaleIds.length > 0) {
            await supabase
              .from('escala_diaria')
              .delete()
              .in('escala_mensal_id', pastScaleIds)
              .is('presenca_entrada_em', null)
              .is('presenca_saida_em', null)

            await supabase
              .from('escala_mensal')
              .delete()
              .in('id', pastScaleIds)
          }
        }
      }
    }
  } catch (cleanError: any) {
    console.error('Erro ao limpar escalas na transferência:', cleanError)
  }

  return { historicoId: histRow?.id }
}

function extractDadosComplementares(formData: FormData) {
  return {
    data_nascimento: (formData.get('data_nascimento') as string)?.trim() || null,
    sexo: (formData.get('sexo') as string)?.trim() || null,
    nacionalidade: (formData.get('nacionalidade') as string)?.trim() || null,
    naturalidade: (formData.get('naturalidade') as string)?.trim() || null,
    nome_mae: (formData.get('nome_mae') as string)?.trim() || null,
    nome_pai: (formData.get('nome_pai') as string)?.trim() || null,
    escolaridade: (formData.get('escolaridade') as string)?.trim() || null,
    estado_civil: (formData.get('estado_civil') as string)?.trim() || null,
    nome_conjuge: (formData.get('nome_conjuge') as string)?.trim() || null,
    endereco_logradouro: (formData.get('endereco_logradouro') as string)?.trim() || null,
    endereco_numero: (formData.get('endereco_numero') as string)?.trim() || null,
    bairro: (formData.get('bairro') as string)?.trim() || null,
    cep: (formData.get('cep') as string)?.trim() || null,
    municipio_residencia: (formData.get('municipio_residencia') as string)?.trim() || null,
    telefone_residencial: (formData.get('telefone_residencial') as string)?.trim() || null,
    rg_numero: (formData.get('rg_numero') as string)?.trim() || null,
    rg_orgao_emissor: (formData.get('rg_orgao_emissor') as string)?.trim() || null,
    rg_data_emissao: (formData.get('rg_data_emissao') as string)?.trim() || null,
    // Somente digitos, pelo mesmo motivo do CPF: e por PIS/NIS que o auditor fiscal casa os
    // registros, e o campo comeca a ser preenchido na Fase 9 do modulo REP.
    pis_pasep: normalizarDoc(formData.get('pis_pasep') as string),
    registro_profissional: (formData.get('registro_profissional') as string)?.trim() || null,
    registro_profissional_orgao: (formData.get('registro_profissional_orgao') as string)?.trim() || null,
    data_admissao_hmm: (formData.get('data_admissao_hmm') as string)?.trim() || null,
    data_admissao_pmm: (formData.get('data_admissao_pmm') as string)?.trim() || null,
    observacao: (formData.get('observacao') as string)?.trim() || null,
    foto_url: (formData.get('foto_url') as string)?.trim() || null,
    banco_nome: (formData.get('banco_nome') as string)?.trim() || null,
    agencia_numero: (formData.get('agencia_numero') as string)?.trim() || null,
    conta_numero: (formData.get('conta_numero') as string)?.trim() || null,
    conta_tipo: (formData.get('conta_tipo') as string)?.trim() || null,
    chave_pix: (formData.get('chave_pix') as string)?.trim() || null,
  }
}

export async function createServidor(formData: FormData) {
  const supabase = await createClient()

  const nome = formData.get('nome') as string
  const matricula = formData.get('matricula') as string
  const cpf = formData.get('cpf') as string
  const cargo = formData.get('cargo') as string
  const vinculo = formData.get('vinculo') as any
  const unidade_id = formData.get('unidade_id') as string
  const setor_id = formData.get('setor_id') as string
  const email = formData.get('email') as string
  const telefone = formData.get('telefone') as string
  const pin_acesso = formData.get('pin_acesso') as string
  const preferenca_turno = formData.get('preferenca_turno') as string || 'Flexivel'
  const carga_horaria_semanal = parseInt(formData.get('carga_horaria_semanal') as string || '40', 10)
  const intervalo_inicio_personalizado = (formData.get('intervalo_inicio_personalizado') as string) || null
  const intervalo_fim_personalizado = (formData.get('intervalo_fim_personalizado') as string) || null

  // Matrícula vazia é preenchida pela trigger trg_atribuir_matricula_temporaria.
  // Não calcule o sequencial aqui: este SELECT passa pela RLS de servidores, que escopa
  // por unidade/setor, enquanto a constraint UNIQUE é global — quem enxerga só parte da
  // tabela gera um número já usado por outra unidade. Ver 20260807110000.
  const matriculaFinal = matricula?.trim() || null

  if (matriculaFinal) {
    // Checagem antecipada só para dar mensagem amigável. Também limitada pela RLS, então
    // a violação da constraint ainda é tratada no insert abaixo.
    const { data: existing, error: checkError } = await supabase
      .from('servidores')
      .select('id')
      .eq('matricula', matriculaFinal)
      .maybeSingle()

    if (checkError) {
      return { error: `Erro ao validar matrícula: ${checkError.message}` }
    }
    if (existing) {
      return { error: 'Esta matrícula já está cadastrada para outro servidor.' }
    }
  }

  // A matrícula sozinha nunca protegeu a unicidade do cadastro: deixada em branco, a trigger
  // trg_atribuir_matricula_temporaria gera uma NOVA, então cadastrar a mesma pessoa duas vezes
  // não colide com nada. O CPF é a chave de identidade real.
  const confirmaVinculoAdicional = formData.get('confirma_vinculo_adicional') === 'true'
  const { erro: erroCpf, vinculoMultiplo } = await verificarCpfDuplicado(supabase, cpf, undefined, confirmaVinculoAdicional)
  if (erroCpf) {
    return { error: erroCpf }
  }

  const ignora_janela_presenca = formData.has('ignora_janela_presenca') ? formData.get('ignora_janela_presenca') === 'true' : false
  const intervalo_flexivel = formData.get('intervalo_flexivel') === 'true'

  const dadosComplementares = extractDadosComplementares(formData)

  const erroDoc = validarDocumentosServidor(cpf, dadosComplementares.pis_pasep)
  if (erroDoc) {
    return { error: erroDoc }
  }

  const erroLotacao = await validarLotacaoNoEscopo(supabase, setor_id || null)
  if (erroLotacao) {
    return { error: erroLotacao }
  }

  const { error } = await supabase.from('servidores').insert({
    nome,
    matricula: matriculaFinal,
    // Normaliza aqui, e nao so no formulario: a action e chamavel direto e a importacao de CSV
    // entrega o que estiver na planilha. Mascara gravada quebra o casamento com o AFD.
    cpf: normalizarDoc(cpf),
    cargo,
    vinculo,
    unidade_id: unidade_id || null,
    setor_id: setor_id || null,
    email: email || null,
    telefone: telefone || null,
    pin_acesso: pin_acesso || null,
    ignora_janela_presenca,
    preferenca_turno,
    carga_horaria_semanal: isNaN(carga_horaria_semanal) ? 40 : carga_horaria_semanal,
    intervalo_inicio_personalizado,
    intervalo_fim_personalizado,
    intervalo_flexivel,
    vinculo_multiplo_confirmado: vinculoMultiplo,
    ...dadosComplementares,
  })

  if (error) {
    return { error: traduzirErroCadastro(error) }
  }

  // Cadastro novo: registra a identidade com que a pessoa entrou no sistema. Sem PIN.
  const { data: { user: autorCriacao } } = await supabase.auth.getUser()
  await registrarLog({
    acao: 'SERVIDOR_CRIADO',
    entidade: 'servidor',
    entidadeId: matriculaFinal || nome,
    userId: autorCriacao?.id || null,
    detalhes: { nome, matricula: matriculaFinal, cpf: cpf || null, cargo, vinculo },
    unidadeId: unidade_id || null,
    setorId: setor_id || null,
  })

  revalidatePath('/servidores')
  redirect('/servidores')
}

// As checagens prévias são limitadas pela RLS: um registro existente em unidade que o usuário
// não enxerga passa batida e só estoura na constraint. Traduz o erro técnico do Postgres para
// algo acionável.
function traduzirErroCadastro(error: { message?: string; code?: string }): string {
  const msg = error?.message || ''
  if (error?.code === '23505' && /servidores_cpf_unico|\bcpf\b/i.test(msg)) {
    return 'Este CPF já está cadastrado para outro servidor, possivelmente em uma unidade que você não visualiza. Cada servidor deve ter um cadastro único — localize o cadastro existente e transfira a lotação em vez de criar outro.'
  }
  if (error?.code === '23505' && /matricula/i.test(msg)) {
    return 'Esta matrícula já está cadastrada para outro servidor, possivelmente em uma unidade que você não visualiza. Confirme a matrícula ou deixe o campo em branco para gerar uma temporária.'
  }
  // Backstop da RLS. `validarLotacaoNoEscopo` pega o caso conhecido antes de chegar no banco, mas se
  // a policy recusar por outra via a pessoa não pode receber o texto cru do Postgres na tela — foi o
  // que a Suemilly viu em 10/08/2026.
  if (error?.code === '42501' || /row-level security/i.test(msg)) {
    return 'Seu perfil não tem permissão para gravar este cadastro com a lotação informada. Confira o setor selecionado: ' +
      'só é possível gravar nos setores vinculados ao seu acesso, e um servidor não pode ficar sem setor.'
  }
  return msg
}

function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"' || char === "'") {
      inQuotes = !inQuotes
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim().replace(/^["']|["']$/g, ''))
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim().replace(/^["']|["']$/g, ''))
  return result
}

function normalizeCSVHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]/g, "")
    .trim()
}

export async function importServidores(csvText: string) {
  const supabase = await createClient()
  
  // Fetch units and sectors for resolution
  const { data: unidades } = await supabase.from('unidades').select('id, nome')
  const { data: sectorsRaw } = await supabase.from('setores').select('id, unidade_id, dicionario_setores(nome)')
  const setores = sectorsRaw?.map(s => ({
    ...s,
    nome: (s as any).dicionario_setores?.nome || ''
  })) || []

  // Linhas sem matrícula vão com null e a trigger trg_atribuir_matricula_temporaria
  // atribui o sequencial, uma a uma, dentro da própria transação do insert.
  // Ver 20260807110000 — calcular aqui colidia por causa da RLS de servidores.

  const lines = csvText.split('\n').filter(line => line.trim() !== '')
  if (lines.length === 0) {
    return { error: 'O arquivo CSV está vazio.' }
  }

  // Detect delimiter (; or ,)
  const firstLine = lines[0]
  const delimiter = firstLine.includes(';') ? ';' : ','

  const rawHeaders = parseCSVLine(firstLine, delimiter)
  const normalizedHeaders = rawHeaders.map(normalizeCSVHeader)

  // Map header aliases to column keys
  const aliasMap: Record<string, string> = {
    nome: 'nome',
    matricula: 'matricula',
    cpf: 'cpf',
    rg: 'rg_numero',
    rg_numero: 'rg_numero',
    numero_rg: 'rg_numero',
    rg_orgao: 'rg_orgao_emissor',
    rg_orgao_emissor: 'rg_orgao_emissor',
    orgao_emissor: 'rg_orgao_emissor',
    rg_emissao: 'rg_data_emissao',
    rg_data_emissao: 'rg_data_emissao',
    data_emissao_rg: 'rg_data_emissao',
    pis: 'pis_pasep',
    pasep: 'pis_pasep',
    pis_pasep: 'pis_pasep',
    nascimento: 'data_nascimento',
    data_nascimento: 'data_nascimento',
    sexo: 'sexo',
    estado_civil: 'estado_civil',
    nome_mae: 'nome_mae',
    mae: 'nome_mae',
    nome_pai: 'nome_pai',
    pai: 'nome_pai',
    escolaridade: 'escolaridade',
    cargo: 'cargo',
    vinculo: 'vinculo',
    carga_horaria: 'carga_horaria_semanal',
    carga_horaria_semanal: 'carga_horaria_semanal',
    email: 'email',
    e_mail: 'email',
    telefone: 'telefone',
    celular: 'telefone',
    telefone_residencial: 'telefone_residencial',
    unidade: 'unidade_nome',
    unidade_lotacao: 'unidade_nome',
    setor: 'setor_nome',
    setor_servico: 'setor_nome',
    cep: 'cep',
    logradouro: 'endereco_logradouro',
    endereco: 'endereco_logradouro',
    endereco_logradouro: 'endereco_logradouro',
    numero: 'endereco_numero',
    endereco_numero: 'endereco_numero',
    bairro: 'bairro',
    municipio: 'municipio_residencia',
    cidade: 'municipio_residencia',
    municipio_residencia: 'municipio_residencia',
    banco: 'banco_nome',
    banco_nome: 'banco_nome',
    agencia: 'agencia_numero',
    agencia_numero: 'agencia_numero',
    conta: 'conta_numero',
    conta_numero: 'conta_numero',
    tipo_conta: 'conta_tipo',
    conta_tipo: 'conta_tipo',
    pix: 'chave_pix',
    chave_pix: 'chave_pix',
    registro_profissional: 'registro_profissional',
    registro: 'registro_profissional',
    orgao_profissional: 'registro_profissional_orgao',
    registro_profissional_orgao: 'registro_profissional_orgao',
    data_admissao: 'data_admissao_pmm',
    data_admissao_pmm: 'data_admissao_pmm',
    observacao: 'observacao',
    observacoes: 'observacao',
  }

  const headerIndices: Record<string, number> = {}
  normalizedHeaders.forEach((h, idx) => {
    const mappedKey = aliasMap[h]
    if (mappedKey) {
      headerIndices[mappedKey] = idx
    }
  })

  // Check if header exists or fallback to positional mapping
  const hasNamedHeader = headerIndices['nome'] !== undefined

  const servers = []

  const startRow = hasNamedHeader ? 1 : 0

  for (let i = startRow; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], delimiter)
    if (values.length === 0) continue

    let nome = ''
    let matricula = ''
    let cargo = ''
    let vinculo = 'Efetiva'
    let email: string | null = null
    let telefone: string | null = null
    let unidadeNome = ''
    let setorNome = ''

    let cpf: string | null = null
    let rg_numero: string | null = null
    let rg_orgao_emissor: string | null = null
    let rg_data_emissao: string | null = null
    let pis_pasep: string | null = null
    let data_nascimento: string | null = null
    let sexo: string | null = null
    let estado_civil: string | null = null
    let nome_mae: string | null = null
    let nome_pai: string | null = null
    let escolaridade: string | null = null
    let carga_horaria_semanal = 40
    let telefone_residencial: string | null = null
    let cep: string | null = null
    let endereco_logradouro: string | null = null
    let endereco_numero: string | null = null
    let bairro: string | null = null
    let municipio_residencia: string | null = null
    let banco_nome: string | null = null
    let agencia_numero: string | null = null
    let conta_numero: string | null = null
    let conta_tipo: string | null = null
    let chave_pix: string | null = null
    let registro_profissional: string | null = null
    let registro_profissional_orgao: string | null = null
    let data_admissao_pmm: string | null = null
    let observacao: string | null = null

    if (hasNamedHeader) {
      nome = values[headerIndices['nome']]?.trim() || ''
      matricula = values[headerIndices['matricula']]?.trim() || ''
      cargo = values[headerIndices['cargo']]?.trim() || ''
      vinculo = values[headerIndices['vinculo']]?.trim() || 'Efetiva'
      email = values[headerIndices['email']]?.trim() || null
      telefone = values[headerIndices['telefone']]?.trim() || null
      unidadeNome = values[headerIndices['unidade_nome']]?.trim() || ''
      setorNome = values[headerIndices['setor_nome']]?.trim() || ''

      cpf = values[headerIndices['cpf']]?.trim() || null
      rg_numero = values[headerIndices['rg_numero']]?.trim() || null
      rg_orgao_emissor = values[headerIndices['rg_orgao_emissor']]?.trim() || null
      rg_data_emissao = values[headerIndices['rg_data_emissao']]?.trim() || null
      pis_pasep = values[headerIndices['pis_pasep']]?.trim() || null
      data_nascimento = values[headerIndices['data_nascimento']]?.trim() || null
      sexo = values[headerIndices['sexo']]?.trim() || null
      estado_civil = values[headerIndices['estado_civil']]?.trim() || null
      nome_mae = values[headerIndices['nome_mae']]?.trim() || null
      nome_pai = values[headerIndices['nome_pai']]?.trim() || null
      escolaridade = values[headerIndices['escolaridade']]?.trim() || null

      const chStr = values[headerIndices['carga_horaria_semanal']]?.trim()
      if (chStr) {
        const parsedCh = parseInt(chStr, 10)
        if (!isNaN(parsedCh)) carga_horaria_semanal = parsedCh
      }

      telefone_residencial = values[headerIndices['telefone_residencial']]?.trim() || null
      cep = values[headerIndices['cep']]?.trim() || null
      endereco_logradouro = values[headerIndices['endereco_logradouro']]?.trim() || null
      endereco_numero = values[headerIndices['endereco_numero']]?.trim() || null
      bairro = values[headerIndices['bairro']]?.trim() || null
      municipio_residencia = values[headerIndices['municipio_residencia']]?.trim() || null
      banco_nome = values[headerIndices['banco_nome']]?.trim() || null
      agencia_numero = values[headerIndices['agencia_numero']]?.trim() || null
      conta_numero = values[headerIndices['conta_numero']]?.trim() || null
      conta_tipo = values[headerIndices['conta_tipo']]?.trim() || null
      chave_pix = values[headerIndices['chave_pix']]?.trim() || null
      registro_profissional = values[headerIndices['registro_profissional']]?.trim() || null
      registro_profissional_orgao = values[headerIndices['registro_profissional_orgao']]?.trim() || null
      data_admissao_pmm = values[headerIndices['data_admissao_pmm']]?.trim() || null
      observacao = values[headerIndices['observacao']]?.trim() || null
    } else {
      // Positional fallback: nome, matricula, cargo, vinculo, email, telefone, unidade, setor
      nome = values[0]?.trim() || ''
      matricula = values[1]?.trim() || ''
      cargo = values[2]?.trim() || ''
      vinculo = values[3]?.trim() || 'Efetiva'
      email = values[4]?.trim() || null
      telefone = values[5]?.trim() || null
      unidadeNome = values[6]?.trim() || ''
      setorNome = values[7]?.trim() || ''
    }

    if (!nome) continue

    const unidadeId = unidades?.find(u => u.nome.toLowerCase() === unidadeNome.toLowerCase())?.id || null
    const setorId = setores?.find(s => s.nome.toLowerCase() === setorNome.toLowerCase() && (unidadeId ? s.unidade_id === unidadeId : true))?.id || null

    servers.push({
      nome,
      // Vazia vira null para a trigger do banco atribuir a matrícula temporária.
      matricula: matricula.trim() || null,
      cpf,
      rg_numero,
      rg_orgao_emissor,
      rg_data_emissao,
      pis_pasep,
      data_nascimento,
      sexo,
      estado_civil,
      nome_mae,
      nome_pai,
      escolaridade,
      cargo,
      vinculo,
      carga_horaria_semanal,
      email,
      telefone,
      telefone_residencial,
      unidade_id: unidadeId,
      setor_id: setorId,
      cep,
      endereco_logradouro,
      endereco_numero,
      bairro,
      municipio_residencia,
      banco_nome,
      agencia_numero,
      conta_numero,
      conta_tipo,
      chave_pix,
      registro_profissional,
      registro_profissional_orgao,
      data_admissao_pmm,
      observacao,
      status: 'Ativo'
    })
  }

  if (servers.length === 0) {
    return { error: 'Nenhum servidor válido encontrado no arquivo CSV enviado.' }
  }

  // ---------------------------------------------------------------------------------------
  // Unicidade do cadastro. O insert é em lote: uma linha duplicada aborta o arquivo inteiro na
  // constraint, com uma mensagem do Postgres que não diz QUAL linha. Conferir antes permite
  // apontar a linha e não deixar o coordenador adivinhando.
  //
  // São duas conferências diferentes, e as duas são necessárias:
  //   1. dentro do próprio CSV — o arquivo pode repetir a mesma pessoa;
  //   2. contra o banco — via RPC SECURITY DEFINER, porque a RLS esconderia um cadastro de
  //      outra unidade e a importação recriaria a pessoa (foi assim que nasceu a duplicata de
  //      VIVIAN MARTINS MACEDO).
  //
  // O dígito verificador entra na mesma varredura. Este caminho não passa por formulário nenhum,
  // então é a ÚNICA camada de aplicação entre a planilha e o banco — e uma planilha é justamente
  // onde CPF digitado errado entra em lote.
  // ---------------------------------------------------------------------------------------
  const problemas: string[] = []
  const vistosNoArquivo = new Map<string, number>()

  for (let idx = 0; idx < servers.length; idx++) {
    const linha = startRow + idx + 1

    // A planilha pode trazer o documento mascarado. Grave só dígitos: mascara quebra o casamento
    // com o identificador do AFD do relógio (armadilha 10 do CLAUDE.md).
    servers[idx].cpf = normalizarDoc(servers[idx].cpf)
    servers[idx].pis_pasep = normalizarDoc(servers[idx].pis_pasep)

    const erroDoc = validarDocumentosServidor(servers[idx].cpf, servers[idx].pis_pasep)
    if (erroDoc) {
      problemas.push(`Linha ${linha} (${servers[idx].nome}): ${erroDoc}`)
      continue
    }

    const cpfLimpo = servers[idx].cpf
    if (!cpfLimpo) continue

    const anterior = vistosNoArquivo.get(cpfLimpo)
    if (anterior !== undefined) {
      problemas.push(`Linha ${linha}: CPF ${cpfLimpo} (${servers[idx].nome}) repetido — já aparece na linha ${anterior}.`)
      continue
    }
    vistosNoArquivo.set(cpfLimpo, linha)

    // Import de CSV via UI não tem como coletar confirmação por linha — continua recusando CPF
    // duplicado (comportamento inalterado). Vínculo duplo em massa é o caminho da importação de
    // RH (fn_promover_pendencia_rh), não deste importador manual.
    const { erro: erroCpf } = await verificarCpfDuplicado(supabase, cpfLimpo)
    if (erroCpf) {
      problemas.push(`Linha ${linha} (${servers[idx].nome}): ${erroCpf}`)
    }
  }

  if (problemas.length > 0) {
    return {
      error: `A importação foi cancelada — nenhum servidor foi cadastrado. Corrija o arquivo:\n\n` +
        problemas.slice(0, 20).join('\n') +
        (problemas.length > 20 ? `\n\n…e mais ${problemas.length - 20} problema(s).` : '')
    }
  }

  const { error } = await supabase.from('servidores').insert(servers)

  if (error) {
    return { error: `Erro ao salvar servidores no banco de dados: ${traduzirErroCadastro(error)}` }
  }

  revalidatePath('/servidores')
  return { success: true }
}

export async function updateServidor(id: string, formData: FormData) {
  const supabase = await createClient()

  const nome = formData.get('nome') as string
  const matricula = formData.get('matricula') as string
  const cpf = formData.get('cpf') as string
  const cargo = formData.get('cargo') as string
  const vinculo = formData.get('vinculo') as any
  const unidade_id = formData.get('unidade_id') as string
  const setor_id = formData.get('setor_id') as string
  const email = formData.get('email') as string
  const telefone = formData.get('telefone') as string
  const pin_acesso = formData.get('pin_acesso') as string
  const preferenca_turno = formData.get('preferenca_turno') as string || 'Flexivel'
  const carga_horaria_semanal = parseInt(formData.get('carga_horaria_semanal') as string || '40', 10)
  const intervalo_inicio_personalizado = (formData.get('intervalo_inicio_personalizado') as string) || null
  const intervalo_fim_personalizado = (formData.get('intervalo_fim_personalizado') as string) || null

  // Esvaziar a matrícula na edição faz a trigger atribuir uma temporária nova.
  // Ver 20260807110000 — o cálculo aqui colidia por causa da RLS de servidores.
  const matriculaFinal = matricula?.trim() || null

  if (matriculaFinal) {
    // Checagem antecipada só para dar mensagem amigável; também limitada pela RLS.
    const { data: existing, error: checkError } = await supabase
      .from('servidores')
      .select('id')
      .eq('matricula', matriculaFinal)
      .neq('id', id)
      .maybeSingle()

    if (checkError) {
      return { error: `Erro ao validar matrícula: ${checkError.message}` }
    }
    if (existing) {
      return { error: 'Esta matrícula já está cadastrada para outro servidor.' }
    }
  }

  const erroDoc = validarDocumentosServidor(cpf, formData.get('pis_pasep') as string)
  if (erroDoc) {
    return { error: erroDoc }
  }

  // Preencher o CPF de um cadastro antigo é justamente quando a duplicata aparece: o registro
  // existia sem CPF e, ao ganhar um, colide com outro cadastro da mesma pessoa.
  const confirmaVinculoAdicionalUpdate = formData.get('confirma_vinculo_adicional') === 'true'
  const { erro: erroCpf, vinculoMultiplo: vinculoMultiploUpdate } = await verificarCpfDuplicado(supabase, cpf, id, confirmaVinculoAdicionalUpdate)
  if (erroCpf) {
    return { error: erroCpf }
  }

  // Query current lotação before updating to check for changes
  // Traz o registro INTEIRO, e não só a lotação: é ele que serve de "antes" para o diff da
  // auditoria. Alterar matrícula, CPF ou telefone de um servidor muda a identidade que sustenta
  // o ponto dele, e até aqui não deixava rastro nenhum.
  const { data: currentServidor, error: fetchError } = await supabase
    .from('servidores')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchError) {
    return { error: `Erro ao obter servidor atual: ${fetchError.message}` }
  }

  // Destino que o formulário pediu — nem sempre é o que vai ser gravado nesta chamada. Ver
  // transferenciaPendente abaixo.
  const destinoUnidadeId = unidade_id || null
  const destinoSetorId = setor_id || null

  const isTransferred = currentServidor.unidade_id !== destinoUnidadeId || currentServidor.setor_id !== destinoSetorId

  // Data e motivo sao exigidos ANTES do UPDATE — nao adianta gravar a lotacao nova e so entao
  // descobrir que falta a justificativa. Vale tanto pra transferência direta quanto pra pedido.
  const dataTransferencia = formData.get('data_transferencia') as string
  const motivoTransferencia = formData.get('motivo_transferencia') as string

  if (isTransferred && (!dataTransferencia || !motivoTransferencia)) {
    return { error: 'Para transferir (ou solicitar a transferência de) um setor ou unidade, a data e o motivo são obrigatórios.' }
  }

  // Só o super_admin efetiva a transferência na hora. Os demais SOLICITAM — decisão do RH depois
  // do incidente de 10/08/2026 (THIELE e KETTELE: duas transferências recusadas pela RLS sem
  // mensagem clara). Ver 20260811110000_add_solicitacoes_transferencia_servidor.sql.
  const { data: { user: usuarioEditor } } = await supabase.auth.getUser()
  const { data: perfilEditor } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', usuarioEditor?.id)
    .single()
  const isSuperAdminEditor = perfilEditor?.role === 'super_admin'

  const transferenciaDireta = isTransferred && isSuperAdminEditor
  const transferenciaPendente = isTransferred && !isSuperAdminEditor

  if (transferenciaPendente) {
    const { data: pendenteExistente } = await supabase
      .from('solicitacoes_transferencia_servidor')
      .select('id')
      .eq('servidor_id', id)
      .eq('status', 'pendente')
      .maybeSingle()

    if (pendenteExistente) {
      return { error: 'Já existe uma solicitação de transferência pendente para este servidor. Aguarde a avaliação do administrador geral antes de pedir outra.' }
    }
  }

  // O que de fato é gravado em `servidores` nesta chamada: o destino pedido, se for transferência
  // direta; o valor ATUAL (sem mudança nenhuma), se for só um pedido — a mudança real só acontece
  // quando o super_admin aprovar (avaliarSolicitacaoTransferencia).
  const unidadeIdGravar = transferenciaPendente ? currentServidor.unidade_id : destinoUnidadeId
  const setorIdGravar = transferenciaPendente ? currentServidor.setor_id : destinoSetorId

  const erroLotacao = await validarLotacaoNoEscopo(supabase, setorIdGravar)
  if (erroLotacao) {
    return { error: erroLotacao }
  }

  const dadosComplementares = extractDadosComplementares(formData)

  const updateData: any = {
    nome,
    matricula: matriculaFinal,
    // Somente digitos — ver o comentario equivalente em createServidor.
    cpf: normalizarDoc(cpf),
    cargo,
    vinculo,
    unidade_id: unidadeIdGravar,
    setor_id: setorIdGravar,
    email: email || null,
    telefone: telefone || null,
    preferenca_turno,
    carga_horaria_semanal: isNaN(carga_horaria_semanal) ? 40 : carga_horaria_semanal,
    intervalo_inicio_personalizado,
    intervalo_fim_personalizado,
    intervalo_flexivel: formData.get('intervalo_flexivel') === 'true',
    ...dadosComplementares,
  }

  if (pin_acesso !== '****') {
    updateData.pin_acesso = pin_acesso || null
  }

  if (formData.has('ignora_janela_presenca')) {
    updateData.ignora_janela_presenca = formData.get('ignora_janela_presenca') === 'true'
  }

  // Só grava true — nunca desliga uma confirmação já dada por omissão do checkbox num submit
  // seguinte que não mexeu no CPF.
  if (vinculoMultiploUpdate) {
    updateData.vinculo_multiplo_confirmado = true
  }

  // `.select('id')` não é enfeite: é ele que revela o UPDATE que não alcançou linha nenhuma.
  let { data: linhasGravadas, error } = await supabase
    .from('servidores')
    .update(updateData)
    .eq('id', id)
    .select('id')

  if (error && (error.message.includes('schema cache') || error.message.includes('column'))) {
    // Caso a migração das colunas bancárias ainda não tenha sido executada no Supabase:
    // Remove temporariamente as colunas bancárias e salva os demais dados do servidor com sucesso
    const fallbackData = { ...updateData }
    delete fallbackData.banco_nome
    delete fallbackData.agencia_numero
    delete fallbackData.conta_numero
    delete fallbackData.conta_tipo
    delete fallbackData.chave_pix

    const fallbackRes = await supabase
      .from('servidores')
      .update(fallbackData)
      .eq('id', id)
      .select('id')

    if (fallbackRes.error) {
      return { error: traduzirErroCadastro(fallbackRes.error) }
    }
    linhasGravadas = fallbackRes.data
  } else if (error) {
    return { error: traduzirErroCadastro(error) }
  }

  // UPDATE que não alcança linha nenhuma NÃO é erro no Postgres — a RLS simplesmente filtra a linha
  // pelo `USING` e o comando devolve sucesso com zero linhas. A policy de leitura é mais larga que
  // a de escrita (20260626225000 deixa ver quem está escalado na unidade), então dá para abrir a
  // ficha de um servidor que não se pode gravar: sem esta checagem a tela redirecionava anunciando
  // sucesso e nada tinha sido salvo.
  if (!linhasGravadas || linhasGravadas.length === 0) {
    return {
      error: 'Nenhuma alteração foi gravada: este servidor está lotado em um setor fora do seu acesso. ' +
        'Você consegue visualizar a ficha porque ele aparece nas escalas da sua unidade, mas a edição ' +
        'é restrita a quem administra o setor de lotação.',
    }
  }

  // A transferência só é EFETIVADA depois que o UPDATE passa. Gravar o histórico antes deixava
  // registro de transferência que nunca aconteceu quando o UPDATE era recusado — foi o que sobrou
  // em produção nas duas tentativas de 10/08/2026 com a KETTELE (SMS/DMAC -> setor nulo).
  //
  // Só entra aqui na transferência DIRETA (super_admin). Pedido de quem não é super_admin
  // (transferenciaPendente) não mexe em historico_transferencias nem limpa escala nenhuma —
  // nada aconteceu de verdade ainda, só foi proposto. Ver o `else if` logo abaixo.
  if (transferenciaDireta) {
    const resultadoTransferencia = await registrarTransferenciaEfetivada(supabase, {
      servidorId: id,
      unidadeOrigemId: currentServidor.unidade_id,
      setorOrigemId: currentServidor.setor_id,
      unidadeDestinoId: destinoUnidadeId,
      setorDestinoId: destinoSetorId,
      dataTransferencia,
      motivo: motivoTransferencia,
      criadoPorId: usuarioEditor?.id || null,
    })
    if (resultadoTransferencia.error) {
      return { error: resultadoTransferencia.error }
    }
  } else if (transferenciaPendente) {
    // Nada muda em servidores nem em escala — só registra o pedido. `unidadeIdGravar`/
    // `setorIdGravar` (o que o UPDATE acima gravou de verdade) continuam iguais ao atual.
    const { error: solicitacaoError } = await supabase
      .from('solicitacoes_transferencia_servidor')
      .insert({
        servidor_id: id,
        unidade_origem_id: currentServidor.unidade_id,
        setor_origem_id: currentServidor.setor_id,
        unidade_destino_id: destinoUnidadeId,
        setor_destino_id: destinoSetorId,
        data_transferencia_sugerida: dataTransferencia,
        motivo: motivoTransferencia,
        solicitado_por_id: usuarioEditor?.id || null,
      })

    if (solicitacaoError) {
      return { error: `Erro ao registrar a solicitação de transferência: ${solicitacaoError.message}` }
    }
  }

  // `pin_acesso` é bcrypt e nunca deve entrar no log com valor. `foto_url` muda a cada upload e
  // só produziria ruído.
  const alteracoesServidor = calcularAlteracoes(currentServidor, updateData, {
    camposSensiveis: ['pin_acesso'],
    ignorar: ['updated_at', 'created_at', 'foto_url'],
  })

  if (Object.keys(alteracoesServidor).length > 0) {
    const { data: { user: autor } } = await supabase.auth.getUser()
    await registrarLog({
      acao: 'SERVIDOR_EDITADO',
      entidade: 'servidor',
      entidadeId: id,
      userId: autor?.id || null,
      alteracoes: alteracoesServidor,
      detalhes: { nome: nome || currentServidor.nome, transferido: transferenciaDireta, transferenciaSolicitada: transferenciaPendente },
      unidadeId: unidadeIdGravar,
      setorId: setorIdGravar,
    })
  }

  revalidatePath('/servidores')
  if (transferenciaPendente) {
    revalidatePath('/servidores/pendencias')
  }
  redirect('/servidores')
}

export async function toggleServidorStatus(id: string, status: 'Ativo' | 'Afastado' | 'Inativo', motivo?: string) {
  const supabase = await createClient()

  const { data: antes } = await supabase.from('servidores').select('status').eq('id', id).single()

  const { error } = await supabase
    .from('servidores')
    .update({
      status,
      // Genérico o bastante pra servir de "motivo da situação" — Afastado precisa de motivo
      // tanto quanto Inativo (licença médica, cedência etc.), não só desligamento.
      motivo_inativacao: status !== 'Ativo' ? (motivo || null) : null
    })
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  // Mudar a situação tira o servidor das escalas futuras e do terminal (Afastado e Inativo, os
  // dois). O motivo importa tanto quanto o ato — sem ele, "por que fulano parou de aparecer?"
  // não tem resposta.
  const { data: { user: autorStatus } } = await supabase.auth.getUser()
  await registrarLog({
    acao: 'SERVIDOR_STATUS_ALTERADO',
    entidade: 'servidor',
    entidadeId: id,
    userId: autorStatus?.id || null,
    alteracoes: { status: { de: antes?.status || null, para: status } },
    detalhes: motivo ? { motivo } : {},
  })

  revalidatePath('/servidores')
  return { success: true }
}

export async function createJornadaTemporaria(
  servidorId: string, 
  jornadaId: string, 
  dataInicio: string, 
  dataFim: string, 
  motivo?: string
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { error } = await supabase
    .from('servidores_jornadas_temporarias')
    .insert({
      servidor_id: servidorId,
      jornada_id: jornadaId,
      data_inicio: dataInicio,
      data_fim: dataFim,
      motivo: motivo || null,
      criado_por: user?.id
    })

  if (error) {
    return { error: error.message }
  }

  revalidatePath(`/servidores/${servidorId}`)
  return { success: true }
}

export async function deleteJornadaTemporaria(id: string, servidorId: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('servidores_jornadas_temporarias')
    .delete()
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath(`/servidores/${servidorId}`)
  return { success: true }
}

/**
 * Promove um vínculo pendente da importação de RH (v1.42.0) para `servidores` de verdade.
 *
 * A escrita real acontece em `fn_promover_pendencia_rh` (20260810160000, SECURITY DEFINER) — esta
 * action só traduz o erro do banco pra mensagem legível, mesmo padrão do resto do arquivo. O gate
 * de vínculo múltiplo (CPF já cadastrado noutra matrícula) é o mesmo de `createServidor`: a RPC
 * recusa sem `confirmaVinculoAdicional`, com mensagem que diz quem já está cadastrado.
 */
export async function promoverPendenciaRh(
  pendenciaId: string,
  unidadeId: string,
  setorId: string,
  cargo: string,
  confirmaVinculoAdicional: boolean = false
) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('fn_promover_pendencia_rh', {
    p_pendencia_id: pendenciaId,
    p_unidade_id: unidadeId,
    p_setor_id: setorId,
    p_cargo: cargo,
    p_confirma_vinculo_adicional: confirmaVinculoAdicional,
  })

  if (error) {
    // RAISE EXCEPTION dentro da função já devolve mensagem em português e acionável (unidade/setor
    // faltando, CPF já cadastrado com nome+matrícula) — repassa direto, sem traduzir de novo.
    return { error: error.message }
  }

  const { data: { user: autor } } = await supabase.auth.getUser()
  await registrarLog({
    acao: 'SERVIDOR_CRIADO',
    entidade: 'servidor',
    entidadeId: data,
    userId: autor?.id || null,
    detalhes: { origem: 'importacao_rh_2026_07', pendenciaId },
    unidadeId,
    setorId,
  })

  revalidatePath('/servidores/pendencias')
  revalidatePath('/servidores')
  return { success: true, servidorId: data as string }
}

/**
 * Aprova ou rejeita um pedido de transferência de unidade/setor (v1.43.0). Só `super_admin` —
 * a RLS de `solicitacoes_transferencia_servidor` (20260811110000) já recusaria o `UPDATE` de
 * qualquer outro papel, mas a checagem aqui dá mensagem legível em vez do erro cru da policy.
 *
 * Aprovar reaproveita `registrarTransferenciaEfetivada` — a mesma função que `updateServidor`
 * usa pra transferência direta do super_admin — pra não ter duas cópias da limpeza de escala.
 */
export async function avaliarSolicitacaoTransferencia(params: {
  solicitacaoId: string
  acao: 'aprovar' | 'rejeitar'
  parecer?: string
}) {
  const { solicitacaoId, acao, parecer } = params
  const supabase = await createClient()

  const { data: { user: avaliador } } = await supabase.auth.getUser()
  const { data: perfilAvaliador } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', avaliador?.id)
    .single()

  if (perfilAvaliador?.role !== 'super_admin') {
    return { error: 'Só o administrador geral pode avaliar solicitações de transferência.' }
  }

  const { data: solicitacao, error: fetchError } = await supabase
    .from('solicitacoes_transferencia_servidor')
    .select('*, servidores(nome)')
    .eq('id', solicitacaoId)
    .eq('status', 'pendente')
    .single()

  if (fetchError || !solicitacao) {
    return { error: 'Solicitação não encontrada, ou já foi avaliada.' }
  }

  if (acao === 'rejeitar') {
    if (!parecer || parecer.trim().length < 5) {
      return { error: 'Informe o motivo da rejeição (mínimo 5 caracteres).' }
    }

    const { error } = await supabase
      .from('solicitacoes_transferencia_servidor')
      .update({ status: 'rejeitada', avaliado_por_id: avaliador?.id, avaliado_em: new Date().toISOString(), parecer: parecer.trim() })
      .eq('id', solicitacaoId)

    if (error) return { error: error.message }

    revalidatePath('/servidores/pendencias')
    return { success: true }
  }

  // Aprovar: efetiva a transferência de verdade — mesmo caminho da transferência direta.
  const { data: linhasGravadas, error: updateError } = await supabase
    .from('servidores')
    .update({ unidade_id: solicitacao.unidade_destino_id, setor_id: solicitacao.setor_destino_id })
    .eq('id', solicitacao.servidor_id)
    .select('id')

  if (updateError) {
    return { error: `Erro ao efetivar a transferência: ${updateError.message}` }
  }
  if (!linhasGravadas || linhasGravadas.length === 0) {
    return { error: 'Nenhuma alteração foi gravada — o servidor pode estar fora do seu escopo de edição.' }
  }

  const resultadoTransferencia = await registrarTransferenciaEfetivada(supabase, {
    servidorId: solicitacao.servidor_id,
    unidadeOrigemId: solicitacao.unidade_origem_id,
    setorOrigemId: solicitacao.setor_origem_id,
    unidadeDestinoId: solicitacao.unidade_destino_id,
    setorDestinoId: solicitacao.setor_destino_id,
    dataTransferencia: solicitacao.data_transferencia_sugerida,
    motivo: solicitacao.motivo,
    criadoPorId: avaliador?.id || null,
  })
  if (resultadoTransferencia.error) {
    return { error: resultadoTransferencia.error }
  }

  const { error: solicitacaoUpdateError } = await supabase
    .from('solicitacoes_transferencia_servidor')
    .update({
      status: 'aprovada',
      avaliado_por_id: avaliador?.id,
      avaliado_em: new Date().toISOString(),
      parecer: parecer?.trim() || null,
      historico_transferencia_id: resultadoTransferencia.historicoId || null,
    })
    .eq('id', solicitacaoId)

  if (solicitacaoUpdateError) {
    return { error: `Transferência efetivada, mas houve erro ao marcar a solicitação como aprovada: ${solicitacaoUpdateError.message}` }
  }

  revalidatePath('/servidores/pendencias')
  revalidatePath(`/servidores/${solicitacao.servidor_id}`)
  revalidatePath('/servidores')
  return { success: true }
}

