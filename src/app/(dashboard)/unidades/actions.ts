'use server'

import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { erroDocumento } from '@/utils/documentos'

/**
 * Le um campo de texto do formulario devolvendo null quando vazio, em vez de string vazia.
 * As CHECK constraints de cnpj/responsavel_cpf so aceitam NULL ou o formato exato — '' seria
 * rejeitado pelo banco.
 */
function textoOuNulo(formData: FormData, campo: string): string | null {
  const valor = (formData.get(campo) as string | null)?.trim()
  return valor ? valor : null
}

/** Idem, mas descarta qualquer caractere de mascara. Ver UnidadeDadosFiscais.tsx. */
function digitosOuNulo(formData: FormData, campo: string): string | null {
  const digitos = ((formData.get(campo) as string | null) || '').replace(/\D/g, '')
  return digitos || null
}

/** Campos fiscais compartilhados por createUnidade e updateUnidade. */
function lerDadosFiscais(formData: FormData) {
  return {
    cnpj: digitosOuNulo(formData, 'cnpj'),
    razao_social: textoOuNulo(formData, 'razao_social'),
    responsavel_nome: textoOuNulo(formData, 'responsavel_nome'),
    responsavel_cpf: digitosOuNulo(formData, 'responsavel_cpf'),
    responsavel_cargo: textoOuNulo(formData, 'responsavel_cargo'),
  }
}

/**
 * Recusa CNPJ e CPF com digito verificador invalido.
 *
 * As CHECK constraints que ja existem (`chk_unidade_cnpj`, `chk_unidade_responsavel_cpf`,
 * criadas em 20260807120000) conferem so o FORMATO — `^[0-9]{14}$` e `^[0-9]{11}$`. Elas aceitam
 * 14 digitos quaisquer, inclusive um CNPJ inexistente. A conferencia de digito e outra coisa, e
 * ate hoje nao existia em camada nenhuma.
 *
 * O CNPJ da unidade vai para o registro tipo 2 do AFD — CNPJ errado ali contamina o arquivo
 * oficial que o auditor le.
 */
function validarDocumentosUnidade(fiscais: ReturnType<typeof lerDadosFiscais>): string | null {
  return erroDocumento(fiscais.cnpj, 'cnpj')
    || (erroDocumento(fiscais.responsavel_cpf, 'cpf')
        ? `Responsável: ${erroDocumento(fiscais.responsavel_cpf, 'cpf')}`
        : null)
}

/**
 * As CHECK constraints do banco devolvem uma mensagem crua e incompreensivel para o usuario
 * final. Traduz as que este formulario pode disparar.
 */
function traduzirErroUnidade(mensagem: string): string {
  if (mensagem.includes('chk_unidade_cnpj_digito')) {
    return 'CNPJ inválido: os dígitos verificadores não conferem. Confira o número no documento.'
  }
  if (mensagem.includes('chk_unidade_responsavel_cpf_digito')) {
    return 'CPF do responsável inválido: os dígitos verificadores não conferem.'
  }
  if (mensagem.includes('chk_unidade_cnpj')) {
    return 'CNPJ inválido: informe os 14 dígitos completos ou deixe o campo em branco.'
  }
  if (mensagem.includes('chk_unidade_responsavel_cpf')) {
    return 'CPF do responsável inválido: informe os 11 dígitos completos ou deixe o campo em branco.'
  }
  return mensagem
}

export async function createUnidade(formData: FormData) {
  const supabase = await createClient()

  const nome = formData.get('nome') as string
  const endereco = formData.get('endereco') as string
  const latitude = formData.get('latitude') ? parseFloat(formData.get('latitude') as string) : null
  const longitude = formData.get('longitude') ? parseFloat(formData.get('longitude') as string) : null
  const raio_geofence = formData.get('raio_geofence') ? parseInt(formData.get('raio_geofence') as string) : 100
  const permite_marca_intervalo = formData.has('permite_marca_intervalo') 
    ? formData.get('permite_marca_intervalo') === 'true' 
    : true
  const tipo_intervalo = (formData.get('tipo_intervalo') as string) || 'flexivel'
  const tolerancia_intervalo_minutos = formData.get('tolerancia_intervalo_minutos') 
    ? parseInt(formData.get('tolerancia_intervalo_minutos') as string) 
    : 5
  const aviso_ponto_whatsapp = formData.has('aviso_ponto_whatsapp')
    ? formData.get('aviso_ponto_whatsapp') === 'true'
    : true

  const id = crypto.randomUUID()
  const logoFile = formData.get('logo') as File | null
  let logo_url = null

  if (logoFile && logoFile.size > 0) {
    const fileExt = logoFile.name.split('.').pop()
    const fileName = `unidade_${id}.${fileExt}`
    const buffer = Buffer.from(await logoFile.arrayBuffer())

    const { error: uploadError } = await supabase.storage
      .from('logos')
      .upload(fileName, buffer, {
        contentType: logoFile.type,
        upsert: true
      })

    if (uploadError) {
      return { error: 'Erro ao fazer upload do logo: ' + uploadError.message }
    }

    const { data: { publicUrl } } = supabase.storage
      .from('logos')
      .getPublicUrl(fileName)

    logo_url = publicUrl
  }

  const fiscais = lerDadosFiscais(formData)
  const erroDoc = validarDocumentosUnidade(fiscais)
  if (erroDoc) {
    return { error: erroDoc }
  }

  const { error } = await supabase.from('unidades').insert({
    id,
    nome,
    endereco,
    latitude,
    longitude,
    raio_geofence,
    logo_url,
    permite_marca_intervalo,
    tipo_intervalo,
    tolerancia_intervalo_minutos,
    aviso_ponto_whatsapp,
    ...fiscais
  })

  if (error) {
    return { error: traduzirErroUnidade(error.message) }
  }

  revalidatePath('/unidades')
  redirect('/unidades')
}

export async function updateUnidade(id: string, formData: FormData) {
  const supabase = await createClient()

  const nome = formData.get('nome') as string
  const endereco = formData.get('endereco') as string
  const latitude = formData.get('latitude') ? parseFloat(formData.get('latitude') as string) : null
  const longitude = formData.get('longitude') ? parseFloat(formData.get('longitude') as string) : null
  const raio_geofence = formData.get('raio_geofence') ? parseInt(formData.get('raio_geofence') as string) : 100
  const permite_marca_intervalo = formData.get('permite_marca_intervalo') === 'true'
  const tipo_intervalo = (formData.get('tipo_intervalo') as string) || 'flexivel'
  const tolerancia_intervalo_minutos = formData.get('tolerancia_intervalo_minutos') ? parseInt(formData.get('tolerancia_intervalo_minutos') as string) : 5

  // Aviso de ponto por WhatsApp. Os campos só entram no update quando o formulário os enviou:
  // um form que não renderize a seção não pode DESLIGAR o aviso de uma unidade por omissão.
  const avisoPonto: any = {}
  if (formData.has('aviso_ponto_whatsapp')) {
    avisoPonto.aviso_ponto_whatsapp = formData.get('aviso_ponto_whatsapp') === 'true'
  }

  const fiscais = lerDadosFiscais(formData)
  const erroDoc = validarDocumentosUnidade(fiscais)
  if (erroDoc) {
    return { error: erroDoc }
  }

  const updateData: any = {
    nome,
    endereco,
    latitude,
    longitude,
    raio_geofence,
    permite_marca_intervalo,
    tipo_intervalo,
    tolerancia_intervalo_minutos,
    ...avisoPonto,
    ...fiscais
  }

  const removeLogo = formData.get('remove_logo') === 'true'
  if (removeLogo) {
    updateData.logo_url = null
  } else {
    const logoFile = formData.get('logo') as File | null
    if (logoFile && logoFile.size > 0) {
      const fileExt = logoFile.name.split('.').pop()
      const fileName = `unidade_${id}.${fileExt}`
      const buffer = Buffer.from(await logoFile.arrayBuffer())

      const { error: uploadError } = await supabase.storage
        .from('logos')
        .upload(fileName, buffer, {
          contentType: logoFile.type,
          upsert: true
        })

      if (uploadError) {
        return { error: 'Erro ao fazer upload do logo: ' + uploadError.message }
      }

      const { data: { publicUrl } } = supabase.storage
        .from('logos')
        .getPublicUrl(fileName)

      updateData.logo_url = publicUrl
    }
  }

  const { error } = await supabase
    .from('unidades')
    .update(updateData)
    .eq('id', id)

  if (error) {
    return { error: traduzirErroUnidade(error.message) }
  }

  // Configurações de comunicação da unidade — o canal próprio que substitui o global.
  //
  // FONTE ÚNICA: `configuracoes_globais`, chave `unidade_comunicacao_<id>`. É de lá que
  // sendWhatsAppMessageAction lê (communication.ts), e é a única via que sempre funcionou.
  //
  // Havia aqui um segundo UPDATE em `unidades.configuracoes_comunicacao`, coluna que NÃO EXISTE
  // em produção — conferido por sonda em 09/08/2026:
  //     column unidades.configuracoes_comunicacao does not exist
  // Pior que ser inútil, era invisível duas vezes: o `try/catch` não pegava nada (o supabase-js
  // devolve `{ error }`, não lança), e o `catch` externo só cobria o JSON.parse. A tela sempre
  // reportou sucesso, mesmo quando nada foi salvo.
  const comunicacaoRaw = formData.get('configuracoes_comunicacao') as string
  if (comunicacaoRaw) {
    let parsedConfig: unknown
    try {
      parsedConfig = JSON.parse(comunicacaoRaw)
    } catch (e) {
      return { error: 'As configurações de comunicação da unidade vieram em formato inválido e não foram salvas.' }
    }

    const { error: comunicacaoError } = await supabase.from('configuracoes_globais').upsert({
      chave: `unidade_comunicacao_${id}`,
      valor: parsedConfig,
      updated_at: new Date().toISOString()
    }, { onConflict: 'chave' })

    // Falha aqui não pode passar como sucesso: a unidade continuaria enviando pelo canal global
    // sem ninguém saber que o canal próprio não foi gravado.
    if (comunicacaoError) {
      return {
        error: `Os dados da unidade foram salvos, mas as configurações de comunicação NÃO foram: ${comunicacaoError.message}`
      }
    }
  }

  revalidatePath('/unidades')
  revalidatePath(`/unidades/${id}`)
  redirect('/unidades')
}

export async function toggleStatusUnidade(id: string, currentStatus: boolean) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('unidades')
    .update({ ativo: !currentStatus })
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/unidades')
  redirect('/unidades')
}
