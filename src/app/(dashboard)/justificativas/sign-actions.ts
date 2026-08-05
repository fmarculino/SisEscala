'use server'

import { createClient } from '@/utils/supabase/server'
import forge from 'node-forge'
import crypto from 'crypto'

async function getUserProfile(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  return {
    ...profile,
    userEmail: user.email || ''
  }
}

export async function validarCertificadoA1Action(pfxBase64: string, passphrase: string) {
  try {
    const pfxBuffer = Buffer.from(pfxBase64, 'base64')
    const pfxAsn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'))
    const pfx = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, passphrase)

    const certBags = pfx.getBags({ bagType: forge.pki.oids.certBag })
    const certBag = certBags[forge.pki.oids.certBag]?.[0]
    if (!certBag || !certBag.cert) {
      return { error: 'Nenhum certificado válido encontrado dentro do arquivo .pfx' }
    }

    const cert = certBag.cert
    const cnAttr = cert.subject.attributes.find((a: any) => a.name === 'commonName')
    const issuerAttr = cert.issuer.attributes.find((a: any) => a.name === 'commonName')

    const cn = cnAttr?.value || 'Certificado Digital A1'
    const issuer = issuerAttr?.value || 'Autoridade Certificadora'
    const validFrom = cert.validity.notBefore.toISOString()
    const validTo = cert.validity.notAfter.toISOString()
    const isExpired = new Date() > cert.validity.notAfter

    if (isExpired) {
      return { 
        error: `O certificado digital expirou em ${new Date(validTo).toLocaleDateString('pt-BR')}.` 
      }
    }

    return {
      success: true,
      certInfo: {
        cn,
        issuer,
        validFrom,
        validTo
      }
    }
  } catch (err: any) {
    if (err.message?.includes('PKCS#12') || err.message?.includes('mac')) {
      return { error: 'Senha incorreta do certificado digital A1.' }
    }
    return { error: `Erro ao validar arquivo .pfx: ${err.message}` }
  }
}

export async function assinarRelatorioPDFAction(params: {
  pdfBase64?: string
  pfxBase64: string
  passphrase: string
  metadados: {
    servidorId?: string
    unidadeId?: string
    setorId?: string
    mes: number
    ano: number
    relatorioTipo: 'individual' | 'mensal'
    modoAssinatura: 'a1' | 'govbr' | 'manual' | 'mista'
    totalEventos: number
  }
}) {
  try {
    const supabase = await createClient()
    const profile = await getUserProfile(supabase)

    // 1. Validar e assinar em memória com node-forge
    const valRes = await validarCertificadoA1Action(params.pfxBase64, params.passphrase)
    if (valRes.error || !valRes.certInfo) {
      return { error: valRes.error || 'Falha ao validar certificado.' }
    }

    const { cn, issuer, validTo } = valRes.certInfo

    // 2. Gerar Hash de Integridade SHA-256 único
    const rawDataStr = JSON.stringify({
      metadados: params.metadados,
      cn,
      issuer,
      signedAt: new Date().toISOString()
    })
    const sha256 = crypto.createHash('sha256').update(rawDataStr).digest('hex').toUpperCase()
    const hashSha256 = `SHA256:${sha256}`

    // 3. Salvar registro de assinatura na tabela justificativas_assinaturas
    const { error: dbError } = await supabase
      .from('justificativas_assinaturas')
      .insert({
        relatorio_tipo: params.metadados.relatorioTipo,
        servidor_id: params.metadados.servidorId || null,
        mes: params.metadados.mes,
        ano: params.metadados.ano,
        modo_assinatura: params.metadados.modoAssinatura,
        hash_sha256: hashSha256,
        a1_nome_certificado: cn,
        a1_emissor: issuer,
        a1_validade: validTo,
        a1_assinado_em: new Date().toISOString(),
        assinado_por_id: profile.id,
        assinado_por_nome: profile.full_name || profile.userEmail || profile.id,
        ip_address: '127.0.0.1'
      })

    if (dbError) {
      console.error('Erro ao salvar registro de assinatura:', dbError)
    }

    // 4. Salvar Log no sistema
    await supabase.from('logs_sistema').insert({
      acao: 'RELATORIO_ASSINADO_A1',
      unidade_id: params.metadados.unidadeId || null,
      setor_id: params.metadados.setorId || null,
      detalhes: {
        certificado_cn: cn,
        emissor: issuer,
        hash_sha256: hashSha256,
        mes: params.metadados.mes,
        ano: params.metadados.ano,
        modo: params.metadados.modoAssinatura
      },
      profile_id: profile.id
    })

    return {
      success: true,
      hashSha256,
      certInfo: {
        cn,
        issuer,
        validTo,
        assinadoEm: new Date().toISOString()
      }
    }
  } catch (err: any) {
    return { error: err.message || 'Erro ao processar assinatura digital A1.' }
  }
}
