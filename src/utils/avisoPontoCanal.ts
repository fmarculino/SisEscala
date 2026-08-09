import { createAdminClient } from '@/utils/supabase/server'

/**
 * Canal de WhatsApp dedicado ao aviso de ponto — opcional.
 *
 * POR QUE ISSO EXISTE
 *   Por padrão o aviso sai pelo mesmo canal de tudo (unidade → global). Na prática isso trouxe
 *   dois problemas, ambos observados em 09/08/2026:
 *
 *   1. A sessão global corresponde a uma caixa do Chatwoot de **atendimento ao público** (Central
 *      de Regulação). A resposta do servidor cai lá, misturada a mensagem de paciente.
 *   2. A regra de automação do Chatwoot filtra por caixa. Com o envio saindo por uma caixa e a
 *      regra escutando outra, a confirmação simplesmente nunca chega — foi exatamente o que
 *      aconteceu no primeiro teste de ponta a ponta.
 *
 *   Preenchendo `aviso_ponto_whatsapp_sid`, só o aviso de ponto passa a sair — e portanto a ser
 *   respondido — por uma caixa própria. Vazio = comportamento anterior, nada muda para ninguém.
 *
 * FONTE ÚNICA
 *   Tanto o worker (que envia o aviso) quanto o webhook (que responde a cortesia) resolvem o
 *   canal por aqui. Se cada um resolvesse por conta própria, a confirmação sairia por uma caixa
 *   e o aviso por outra — que é a origem do problema que esta função resolve.
 */
export async function resolverCanalAvisoPonto(): Promise<Record<string, string> | undefined> {
  try {
    const supabase = await createAdminClient()
    const { data } = await supabase
      .from('configuracoes_globais')
      .select('chave, valor')
      .in('chave', ['aviso_ponto_whatsapp_sid', 'aviso_ponto_whatsapp_url', 'aviso_ponto_whatsapp_key'])

    const ler = (chave: string) => {
      const linha = (data || []).find((c: any) => c.chave === chave)
      if (linha?.valor == null) return null
      const v = typeof linha.valor === 'string' ? linha.valor : String(linha.valor).replace(/^"|"$/g, '')
      return v.trim() || null
    }

    const sid = ler('aviso_ponto_whatsapp_sid')
    if (!sid) return undefined

    const url = ler('aviso_ponto_whatsapp_url')
    const key = ler('aviso_ponto_whatsapp_key')

    return {
      whatsapp_astracall_sid: sid,
      // url e key só entram quando preenchidas — senão herdam as globais, que costumam servir:
      // trocar de caixa dentro do mesmo provedor não muda o endereço nem a credencial.
      ...(url ? { whatsapp_astracall_url: url } : {}),
      ...(key ? { whatsapp_astracall_key: key } : {}),
    }
  } catch (err) {
    // Falhar aqui não pode impedir o envio: sem canal dedicado, cai no comportamento padrão.
    console.warn('Não foi possível resolver o canal do aviso de ponto:', err)
    return undefined
  }
}
