'use server'

import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

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
    pis_pasep: (formData.get('pis_pasep') as string)?.trim() || null,
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

  let matriculaFinal = matricula?.trim() || ''

  if (!matriculaFinal) {
    const yearSuffix = new Date().getFullYear().toString().slice(-2)
    const prefix = `T${yearSuffix}`
    
    const { data, error: fetchError } = await supabase
      .from('servidores')
      .select('matricula')
      .like('matricula', `${prefix}%`)
      .order('matricula', { ascending: false })
      .limit(1)

    if (fetchError) {
      return { error: `Erro ao gerar matrícula temporária: ${fetchError.message}` }
    }

    let nextSeq = 1
    if (data && data.length > 0 && data[0].matricula) {
      const currentSeqStr = data[0].matricula.slice(prefix.length)
      const currentSeq = parseInt(currentSeqStr, 10)
      if (!isNaN(currentSeq)) {
        nextSeq = currentSeq + 1
      }
    }
    matriculaFinal = `${prefix}${String(nextSeq).padStart(5, '0')}`
  } else {
    // Validar unicidade de matrícula definitiva
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

  const ignora_janela_presenca = formData.has('ignora_janela_presenca') ? formData.get('ignora_janela_presenca') === 'true' : false

  const dadosComplementares = extractDadosComplementares(formData)

  const { error } = await supabase.from('servidores').insert({
    nome,
    matricula: matriculaFinal,
    cpf: cpf || null,
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
    ...dadosComplementares,
  })

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/servidores')
  redirect('/servidores')
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

  // Obter o sequencial máximo da matrícula temporária atual para evitar colisões
  const yearSuffix = new Date().getFullYear().toString().slice(-2)
  const prefix = `T${yearSuffix}`
  const { data: lastRecord } = await supabase
    .from('servidores')
    .select('matricula')
    .like('matricula', `${prefix}%`)
    .order('matricula', { ascending: false })
    .limit(1)

  let nextSeq = 1
  if (lastRecord && lastRecord.length > 0 && lastRecord[0].matricula) {
    const currentSeqStr = lastRecord[0].matricula.slice(prefix.length)
    const currentSeq = parseInt(currentSeqStr, 10)
    if (!isNaN(currentSeq)) {
      nextSeq = currentSeq + 1
    }
  }

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

    // Se a matrícula for nula/vazia, gerar código temporário sequencial
    if (!matricula) {
      matricula = `${prefix}${String(nextSeq).padStart(5, '0')}`
      nextSeq++
    }

    const unidadeId = unidades?.find(u => u.nome.toLowerCase() === unidadeNome.toLowerCase())?.id || null
    const setorId = setores?.find(s => s.nome.toLowerCase() === setorNome.toLowerCase() && (unidadeId ? s.unidade_id === unidadeId : true))?.id || null

    servers.push({
      nome,
      matricula,
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

  const { error } = await supabase.from('servidores').insert(servers)

  if (error) {
    return { error: `Erro ao salvar servidores no banco de dados: ${error.message}` }
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

  let matriculaFinal = matricula?.trim() || ''

  if (!matriculaFinal) {
    const yearSuffix = new Date().getFullYear().toString().slice(-2)
    const prefix = `T${yearSuffix}`
    
    const { data, error: fetchError } = await supabase
      .from('servidores')
      .select('matricula')
      .like('matricula', `${prefix}%`)
      .order('matricula', { ascending: false })
      .limit(1)

    if (fetchError) {
      return { error: `Erro ao gerar matrícula temporária: ${fetchError.message}` }
    }

    let nextSeq = 1
    if (data && data.length > 0 && data[0].matricula) {
      const currentSeqStr = data[0].matricula.slice(prefix.length)
      const currentSeq = parseInt(currentSeqStr, 10)
      if (!isNaN(currentSeq)) {
        nextSeq = currentSeq + 1
      }
    }
    matriculaFinal = `${prefix}${String(nextSeq).padStart(5, '0')}`
  } else {
    // Validar unicidade da matrícula (ignorando o registro do próprio servidor atual)
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

  // Query current lotação before updating to check for changes
  const { data: currentServidor, error: fetchError } = await supabase
    .from('servidores')
    .select('unidade_id, setor_id')
    .eq('id', id)
    .single()

  if (fetchError) {
    return { error: `Erro ao obter servidor atual: ${fetchError.message}` }
  }

  const newUnidadeId = unidade_id || null
  const newSetorId = setor_id || null

  const isTransferred = currentServidor.unidade_id !== newUnidadeId || currentServidor.setor_id !== newSetorId

  if (isTransferred) {
    const dataTransferencia = formData.get('data_transferencia') as string
    const motivoTransferencia = formData.get('motivo_transferencia') as string

    if (!dataTransferencia || !motivoTransferencia) {
      return { error: 'Para realizar uma transferência de setor ou unidade, a data e o motivo são obrigatórios.' }
    }

    const { data: { user } } = await supabase.auth.getUser()
    const criado_por_id = user?.id || null

    const { error: histError } = await supabase
      .from('historico_transferencias')
      .insert({
        servidor_id: id,
        unidade_origem_id: currentServidor.unidade_id,
        setor_origem_id: currentServidor.setor_id,
        unidade_destino_id: newUnidadeId,
        setor_destino_id: newSetorId,
        data_transferencia: dataTransferencia,
        motivo: motivoTransferencia,
        criado_por_id
      })

    if (histError) {
      return { error: `Erro ao salvar histórico de transferência: ${histError.message}` }
    }

    // Clear concurrent scale shifts in both sectors for the transfer month/year and subsequent/preceding periods
    try {
      const dateParts = dataTransferencia.split('-')
      const transferYear = parseInt(dateParts[0], 10)
      const transferMonth = parseInt(dateParts[1], 10)
      const transferDay = parseInt(dateParts[2], 10)

      if (!isNaN(transferYear) && !isNaN(transferMonth) && !isNaN(transferDay)) {
        // A. Origin Scale (Transfer Month): Clear shifts on and after the transfer day (without presence)
        if (currentServidor.unidade_id && currentServidor.setor_id) {
          const { data: originScale } = await supabase
            .from('escala_mensal')
            .select('id')
            .eq('servidor_id', id)
            .eq('unidade_id', currentServidor.unidade_id)
            .eq('setor_id', currentServidor.setor_id)
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
        if (newUnidadeId && newSetorId) {
          const { data: destScale } = await supabase
            .from('escala_mensal')
            .select('id')
            .eq('servidor_id', id)
            .eq('unidade_id', newUnidadeId)
            .eq('setor_id', newSetorId)
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
        if (currentServidor.unidade_id && currentServidor.setor_id) {
          const { data: futureOriginScales } = await supabase
            .from('escala_mensal')
            .select('id, mes, ano')
            .eq('servidor_id', id)
            .eq('unidade_id', currentServidor.unidade_id)
            .eq('setor_id', currentServidor.setor_id)

          if (futureOriginScales) {
            const futureScaleIds = futureOriginScales
              .filter(em => em.ano > transferYear || (em.ano === transferYear && em.mes > transferMonth))
              .map(em => em.id)

            if (futureScaleIds.length > 0) {
              // Deletar turnos diários sem presença
              await supabase
                .from('escala_diaria')
                .delete()
                .in('escala_mensal_id', futureScaleIds)
                .is('presenca_entrada_em', null)
                .is('presenca_saida_em', null)

              // Tentar deletar as escalas mensais correspondentes
              await supabase
                .from('escala_mensal')
                .delete()
                .in('id', futureScaleIds)
            }
          }
        }

        // D. Preceding Months (Destination Sector): Delete any monthly scales and daily shifts without presence
        if (newUnidadeId && newSetorId) {
          const { data: pastDestScales } = await supabase
            .from('escala_mensal')
            .select('id, mes, ano')
            .eq('servidor_id', id)
            .eq('unidade_id', newUnidadeId)
            .eq('setor_id', newSetorId)

          if (pastDestScales) {
            const pastScaleIds = pastDestScales
              .filter(em => em.ano < transferYear || (em.ano === transferYear && em.mes < transferMonth))
              .map(em => em.id)

            if (pastScaleIds.length > 0) {
              // Deletar turnos diários sem presença
              await supabase
                .from('escala_diaria')
                .delete()
                .in('escala_mensal_id', pastScaleIds)
                .is('presenca_entrada_em', null)
                .is('presenca_saida_em', null)

              // Tentar deletar as escalas mensais correspondentes
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
  }

  const dadosComplementares = extractDadosComplementares(formData)

  const updateData: any = {
    nome,
    matricula: matriculaFinal,
    cpf: cpf || null,
    cargo,
    vinculo,
    unidade_id: newUnidadeId,
    setor_id: newSetorId,
    email: email || null,
    telefone: telefone || null,
    preferenca_turno,
    carga_horaria_semanal: isNaN(carga_horaria_semanal) ? 40 : carga_horaria_semanal,
    ...dadosComplementares,
  }

  if (pin_acesso !== '****') {
    updateData.pin_acesso = pin_acesso || null
  }

  if (formData.has('ignora_janela_presenca')) {
    updateData.ignora_janela_presenca = formData.get('ignora_janela_presenca') === 'true'
  }

  let { error } = await supabase
    .from('servidores')
    .update(updateData)
    .eq('id', id)

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

    if (fallbackRes.error) {
      return { error: fallbackRes.error.message }
    }
  } else if (error) {
    return { error: error.message }
  }

  revalidatePath('/servidores')
  redirect('/servidores')
}

export async function toggleServidorStatus(id: string, status: 'Ativo' | 'Inativo', motivo?: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('servidores')
    .update({ 
      status,
      motivo_inativacao: status === 'Inativo' ? motivo : null
    })
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

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

